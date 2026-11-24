#!/bin/sh
set -eu
umask 077
export LC_ALL=C

test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' 0
trap 'exit 1' HUP INT TERM

script=$(dirname "$0")/keyfold-backup.sh
export KEYFOLD_DATA_DIR="$test_dir/vault"
export KEYFOLD_BACKUP_DIR="$test_dir/backups"
export KEYFOLD_BACKUP_KEEP=3
export PATH="$test_dir/bin:$PATH"
mkdir "$test_dir/bin" "$KEYFOLD_DATA_DIR" "$KEYFOLD_BACKUP_DIR"
lock=$KEYFOLD_BACKUP_DIR/.keyfold.lock

cat > "$test_dir/bin/keyfold-server" <<'EOF'
#!/bin/sh
set -eu
[ "$#" -eq 4 ] && [ "$1" = -data ] && [ "$2" = "$KEYFOLD_DATA_DIR" ] && [ "$3" = -backup ] || exit 2
[ ! -e "$4" ] || exit 2
[ "${FAKE_BACKUP_FAIL:-0}" = 0 ] || exit 1
printf '%s\n' "$FAKE_BACKUP_RUN" > "$4"
EOF
chmod 755 "$test_dir/bin/keyfold-server"

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

unrelated=$KEYFOLD_BACKUP_DIR/manual.tar
similar=$KEYFOLD_BACKUP_DIR/keyfold-unrelated.tar
recent_partial=$KEYFOLD_BACKUP_DIR/keyfold-20000101T000000Z.tar.partial-1
stale_partial=$KEYFOLD_BACKUP_DIR/keyfold-20000101T000000Z.tar.partial-2
printf 'keep\n' > "$unrelated"
printf 'keep\n' > "$similar"
touch "$recent_partial"
touch -t 200001010000 "$stale_partial"

run=1
while [ "$run" -le 5 ]; do
    FAKE_BACKUP_RUN=$run sh "$script"
    [ ! -e "$lock" ] || fail 'a successful run left the lock behind'
    set -- "$KEYFOLD_BACKUP_DIR"/keyfold-[0-9]*.tar
    expected=1
    if [ "$run" -gt "$KEYFOLD_BACKUP_KEEP" ]; then
        expected=$((run - KEYFOLD_BACKUP_KEEP + 1))
    fi
    for file do
        if ! printf '%s\n' "${file##*/}" | grep -Eq '^keyfold-[0-9]{8}T[0-9]{6}Z\.tar$'; then
            fail "unexpected archive name: ${file##*/}"
        fi
        [ "$(cat "$file")" = "$expected" ] || fail "expected archive from run $expected"
        expected=$((expected + 1))
    done
    [ "$expected" -eq "$((run + 1))" ] || fail "wrong archive count after run $run"
    run=$((run + 1))
done
printf '%s\n' 'PASS: one UTC-named archive per run and only runs 3, 4, and 5 remain'

touch -t 200001010000 "$stale_partial"
if FAKE_BACKUP_FAIL=1 KEYFOLD_BACKUP_KEEP=1 sh "$script"; then
    fail 'a failing backup reported success'
fi
[ ! -e "$lock" ] || fail 'a failed run left the lock behind'
for file do
    [ -s "$file" ] || fail 'a failed run removed an archive'
done
[ -f "$stale_partial" ] || fail 'a failed run removed a stale partial'
printf '%s\n' 'PASS: a failed backup leaves all archives and partials in place'

if [ "$(cat "$unrelated")" != keep ] || [ "$(cat "$similar")" != keep ]; then
    fail 'an unrelated file changed'
fi
printf '%s\n' 'PASS: unrelated files are preserved'

mkdir "$lock" "$lock/active"
if output=$(FAKE_BACKUP_RUN=blocked KEYFOLD_BACKUP_KEEP=1 sh "$script" 2>&1); then
    fail 'a run with the lock held reported success'
fi
case $output in
    *'backup lock'*) ;;
    *) fail 'a run with the lock held gave no lock error' ;;
esac
for file do
    [ -s "$file" ] || fail 'a run with the lock held removed an archive'
done
set -- "$KEYFOLD_BACKUP_DIR"/keyfold-[0-9]*.tar
[ "$#" -eq "$KEYFOLD_BACKUP_KEEP" ] || fail 'a run with the lock held created an archive'
[ -d "$lock/active" ] || fail 'a run with the lock held removed the lock'
printf '%s\n' 'PASS: a held lock blocks the backup and leaves all archives in place'

[ -f "$recent_partial" ] || fail 'a recent partial was removed'
touch -t 200001010000 "$lock"
FAKE_BACKUP_RUN=6 sh "$script"
[ ! -e "$lock" ] || fail 'a successful takeover left the lock behind'
set -- "$KEYFOLD_BACKUP_DIR"/keyfold-[0-9]*.tar
[ "$#" -eq "$KEYFOLD_BACKUP_KEEP" ] || fail 'wrong archive count after a stale lock takeover'
[ "$(cat "$3")" = 6 ] || fail 'a stale lock takeover did not create an archive'
printf '%s\n' 'PASS: a stale lock is taken over and released after a successful backup'
if [ -e "$stale_partial" ] || [ ! -f "$recent_partial" ]; then
    fail 'partial cleanup ignored file age'
fi
printf '%s\n' 'PASS: successful backups remove stale partials and preserve recent partials'

export KEYFOLD_BACKUP_DIR="$test_dir/clock-rollback"
mkdir "$KEYFOLD_BACKUP_DIR"
for day in 01 02 03; do
    printf 'future\n' > "$KEYFOLD_BACKUP_DIR/keyfold-299901${day}T000000Z.tar"
done
FAKE_BACKUP_RUN=rollback sh "$script"
set -- "$KEYFOLD_BACKUP_DIR"/keyfold-*.tar
[ "$#" -eq 3 ] || fail 'wrong archive count after clock rollback'
[ "$(cat "$1")" = rollback ] || fail 'rotation removed the new archive after clock rollback'
[ ! -e "$KEYFOLD_BACKUP_DIR/keyfold-29990101T000000Z.tar" ] || fail 'rotation kept the oldest future archive'
printf '%s\n' 'PASS: clock rollback keeps the new archive and the two newest older archives'
