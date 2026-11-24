#!/bin/sh
set -eu
umask 077
export LC_ALL=C

data_dir=${KEYFOLD_DATA_DIR:-/var/lib/keyfold}
backup_dir=${KEYFOLD_BACKUP_DIR:-/var/lib/keyfold-backups}
keep=${KEYFOLD_BACKUP_KEEP:-14}

case $keep in
    *[!0-9]*) keep=0 ;;
esac
if ! [ "$keep" -gt 0 ] 2>/dev/null; then
    printf '%s\n' 'KEYFOLD_BACKUP_KEEP must be a positive integer' >&2
    exit 1
fi

case $backup_dir in
    /*) ;;
    *) backup_dir=./$backup_dir ;;
esac
mkdir -p "$backup_dir"

# Reserve the UTC second so simultaneous runs cannot pick the same name.
while :; do
    stamp=$(date -u '+%Y%m%dT%H%M%SZ')
    archive=$backup_dir/keyfold-$stamp.tar
    reservation=$backup_dir/.keyfold-$stamp.lock
    if mkdir "$reservation" 2>/dev/null; then
        if [ ! -e "$archive" ] && [ ! -L "$archive" ]; then
            break
        fi
        rmdir "$reservation"
    elif [ ! -d "$reservation" ] && [ ! -e "$archive" ]; then
        printf 'Cannot reserve backup name in %s\n' "$backup_dir" >&2
        exit 1
    fi
    sleep 1
done
trap 'rmdir "$reservation"' 0
trap 'exit 1' HUP INT TERM

keyfold-server -data "$data_dir" -backup "$archive"
if [ ! -f "$archive" ] || [ ! -s "$archive" ]; then
    printf 'Backup archive is missing or empty: %s\n' "$archive" >&2
    exit 1
fi

# In the C locale the fixed-width timestamps sort from oldest to newest.
digits='[0-9][0-9]'
archive_name=keyfold-$digits$digits$digits${digits}T$digits$digits${digits}Z.tar
set --
for file in "$backup_dir"/keyfold-*.tar; do
    # The variable is deliberately matched as a glob.
    # shellcheck disable=SC2254
    case ${file##*/} in
        $archive_name)
            if [ -f "$file" ] && [ ! -L "$file" ] && [ -s "$file" ]; then
                set -- "$@" "$file"
            fi
            ;;
    esac
done
while [ "$#" -gt "$keep" ]; do
    rm -f "$1"
    shift
done

# Go writes unfinished archives alongside the final name with a numeric suffix.
find "$backup_dir/." ! -name . -prune -type f \
    -name "$archive_name.partial-[0-9]*" ! -name '*.partial-*[!0-9]*' \
    -mtime +0 -exec rm -f {} +
