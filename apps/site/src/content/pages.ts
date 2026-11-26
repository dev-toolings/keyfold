import type { Lang } from "@/content/landing";

/**
 * The content pages of the public site, one topic each, in both languages.
 * Every fact comes from the repository README. Text between backticks renders as inline code.
 */
export type PageKey = "security" | "cli" | "mcp" | "self-hosting";

export type Block =
  | { p: string }
  | { list: string[] }
  | { code: string }
  | { table: { head: string[]; rows: string[][] } };

export type Section = { id: string; title: string; blocks: Block[] };

export type PageContent = {
  /** Last path segment: "/securite" in French, "/en/security" in English. */
  slug: string;
  /** Short label for navigation and breadcrumbs. */
  nav: string;
  /** Meta title, under 60 characters, and meta description, under 160. */
  title: string;
  description: string;
  h1: string;
  /** The direct answer: one or two sentences an answer engine can quote alone. */
  lede: string;
  sections: Section[];
};

export type DocPage = {
  key: PageKey;
  /**
   * Date of the last content change (ISO), shown on the page and published as lastmod in the
   * sitemap. Change it with every edit of the page's content, and only then.
   */
  updated: string;
  content: Record<Lang, PageContent>;
};

type Labels = { home: string; docs: string; updated: string; onThisPage: string; related: string };

export const PAGE_LABELS: Record<Lang, Labels> = {
  fr: {
    home: "Accueil",
    docs: "Documentation",
    updated: "Mis à jour le",
    onThisPage: "Sur cette page",
    related: "À lire aussi",
  },
  en: { home: "Home", docs: "Documentation", updated: "Updated on", onThisPage: "On this page", related: "Read next" },
};

const security: DocPage = {
  key: "security",
  updated: "2026-11-11",
  content: {
    en: {
      slug: "security",
      nav: "Security",
      title: "Security model: client-side age encryption | Keyfold",
      description:
        "How Keyfold encrypts secrets with age in the client, what the server stores, how sessions and the TOTP second factor work, and what is not protected yet.",
      h1: "Security model",
      lede: "Keyfold encrypts every secret in the client with age, before it reaches the server. The server stores encrypted files and never sees the master password, the vault identity or a value.",
      sections: [
        {
          id: "encryption",
          title: "How is a secret encrypted?",
          blocks: [
            {
              p: "Encryption happens in the browser or in the `kf` command line, never on the server, with age.",
            },
            {
              list: [
                "The vault identity is an age X25519 key.",
                "That identity is encrypted with your master password, through the age scrypt recipient.",
                "Each item, its name included, is a separate age file encrypted to that identity.",
                "Attachments are encrypted in the browser with age too, and stored apart in `data/blobs/`.",
              ],
            },
          ],
        },
        {
          id: "server",
          title: "What does the server store and see?",
          blocks: [
            {
              table: {
                head: ["The server stores", "The server never sees"],
                rows: [
                  ["Encrypted item files", "Your master password"],
                  ["Encrypted attachments", "The vault identity"],
                  ["The encrypted identity", "A secret value"],
                  ["The TOTP secret in cleartext, once set up", "An item name"],
                ],
              },
            },
            {
              p: "Each access log line includes the method, path, status, duration, client IP, request ID and matched route pattern when available. It omits raw headers, the body and the query string. An internal error also logs its text, which can include file paths or operating system errors.",
            },
          ],
        },
        {
          id: "master-password",
          title: "Why does the master password matter so much?",
          blocks: [
            {
              p: "Anyone who obtains a copy of the encrypted identity, for example from a stolen disk, can try master passwords offline. The master password protects the identity in that copy.",
            },
            {
              p: "That is why a new vault needs a master password of at least 16 characters, in the web UI and in `kf init`.",
            },
          ],
        },
        {
          id: "sessions",
          title: "How do sessions work?",
          blocks: [
            {
              list: [
                "Protected API routes require a session token. To obtain one, decrypt a random challenge with the vault identity.",
                "A challenge expires after 60 seconds. A session expires after 15 minutes of inactivity or 12 hours from creation, whichever comes first. Challenges and sessions live in server memory and are lost on restart.",
                "The web UI keeps the identity and token in memory only. It tries to clear a copied secret from the clipboard after 30 seconds.",
                "The CLI agent receives the identity through a pipe, never argv or the environment, and serves it on a `0600` socket in a `0700` directory. It exits after its TTL or on `kf lock`.",
              ],
            },
          ],
        },
        {
          id: "totp",
          title: "What does the second factor add?",
          blocks: [
            {
              p: "With TOTP off, the encrypted identity is available only to a loopback client using a loopback host with no forwarding headers. With TOTP on, downloading it requires a valid code or a live session.",
            },
            {
              list: [
                "The server rejects reused TOTP time steps across all clients and keeps the last accepted step in memory. After a restart, a code can be accepted again if it is still within the accepted window.",
                "Five wrong or replayed codes in a row lock TOTP checks for that client for 15 minutes. Each remote IP also has one budget of 60 calls per minute across status, vault creation, identity download, challenge and session routes. Direct loopback requests have a separate TOTP limit and are exempt from the call limit.",
                "The TOTP secret is stored in clear in `data/totp.json` (mode 0600), because the server must read it alone. TOTP does not protect a stolen disk.",
                "Phone lost: run `keyfold-server -disable-totp -data ./data` on the server machine.",
              ],
            },
          ],
        },
        {
          id: "limits",
          title: "What are the limits to know?",
          blocks: [
            {
              list: [
                "The server speaks plain HTTP and listens on loopback by default. For other devices, use a TLS reverse proxy on the same machine. Declare its host with `-allowed-hosts` and have the proxy preserve `Host` and append the client IP to `X-Forwarded-For`. The server accepts loopback and declared hosts.",
                "`packaging/` includes a container, a Compose example with Caddy and a systemd unit. The backup timer keeps local archives. Copying them off the machine is up to the operator.",
                "Changing the master password re-wraps the same identity: items are not re-encrypted, and an older copy of the data directory still opens with the old password.",
                "The breach check against Have I Been Pwned is off by default. Once allowed in Settings, it runs on request and sends only the first 5 characters of each password's SHA-1.",
              ],
            },
          ],
        },
      ],
    },
    fr: {
      slug: "securite",
      nav: "Sécurité",
      title: "Modèle de sécurité : chiffrement age côté client | Keyfold",
      description:
        "Comment Keyfold chiffre vos secrets avec age côté client, ce que le serveur stocke, le rôle des sessions et du TOTP, et ce qui n'est pas encore protégé.",
      h1: "Modèle de sécurité",
      lede: "Keyfold chiffre chaque secret côté client avec age, avant qu'il n'atteigne le serveur. Le serveur stocke des fichiers chiffrés et ne voit jamais ni le mot de passe principal, ni l'identité du coffre, ni aucune valeur.",
      sections: [
        {
          id: "chiffrement",
          title: "Comment un secret est-il chiffré ?",
          blocks: [
            {
              p: "Le chiffrement se fait dans le navigateur ou dans la ligne de commande `kf`, jamais sur le serveur, avec age.",
            },
            {
              list: [
                "L'identité du coffre est une clé age X25519.",
                "Cette identité est chiffrée par votre mot de passe principal, avec le destinataire scrypt de age.",
                "Chaque élément, nom compris, est un fichier age distinct chiffré pour cette identité.",
                "Les pièces jointes sont elles aussi chiffrées avec age dans le navigateur, et rangées à part dans `data/blobs/`.",
              ],
            },
          ],
        },
        {
          id: "serveur",
          title: "Que stocke et que voit le serveur ?",
          blocks: [
            {
              table: {
                head: ["Le serveur stocke", "Le serveur ne voit jamais"],
                rows: [
                  ["Les fichiers chiffrés des éléments", "Votre mot de passe principal"],
                  ["Les pièces jointes chiffrées", "L'identité du coffre"],
                  ["L'identité chiffrée", "La valeur d'un secret"],
                  ["Le secret TOTP en clair, dès sa configuration", "Le nom d'un élément"],
                ],
              },
            },
            {
              p: "Chaque ligne du journal d'accès indique la méthode, le chemin, le statut, la durée, l'adresse IP du client, l'identifiant de requête et, si disponible, le motif de la route. Elle omet les en-têtes bruts, le corps et la chaîne de requête. Une erreur interne est aussi journalisée avec son texte, qui peut inclure des chemins de fichiers ou des erreurs du système.",
            },
          ],
        },
        {
          id: "mot-de-passe-principal",
          title: "Pourquoi le mot de passe principal compte-t-il autant ?",
          blocks: [
            {
              p: "Quiconque obtient une copie de l'identité chiffrée, par exemple sur un disque volé, peut essayer des mots de passe hors ligne. Le mot de passe principal protège l'identité dans cette copie.",
            },
            {
              p: "C'est pourquoi un nouveau coffre exige un mot de passe principal d'au moins 16 caractères, dans l'interface web comme avec `kf init`.",
            },
          ],
        },
        {
          id: "sessions",
          title: "Comment fonctionnent les sessions ?",
          blocks: [
            {
              list: [
                "Les routes protégées de l'API exigent un jeton de session. Pour l'obtenir, déchiffrez un défi aléatoire avec l'identité du coffre.",
                "Un défi expire après 60 secondes. Une session expire après 15 minutes d'inactivité ou 12 heures après sa création, au premier des deux délais. Les défis et les sessions sont gardés en mémoire et disparaissent au redémarrage du serveur.",
                "L'interface web garde l'identité et le jeton en mémoire seulement. Elle tente d'effacer un secret copié du presse-papiers après 30 secondes.",
                "L'agent de la CLI reçoit l'identité par un tube, jamais par argv ni par l'environnement, et la sert sur un socket `0600` dans un dossier `0700`. Il s'arrête à la fin de sa durée de vie ou sur `kf lock`.",
              ],
            },
          ],
        },
        {
          id: "totp",
          title: "Qu'apporte le second facteur ?",
          blocks: [
            {
              p: "Sans TOTP, l'identité chiffrée est réservée aux clients en boucle locale qui utilisent un nom d'hôte de boucle locale, sans en-tête de transfert. Avec le TOTP activé, son téléchargement exige un code valide ou une session active.",
            },
            {
              list: [
                "Le serveur refuse de réutiliser un créneau TOTP, tous clients confondus, et garde en mémoire le dernier créneau accepté. Après un redémarrage, un code peut être accepté à nouveau s'il est encore dans la fenêtre admise.",
                "Cinq codes incorrects ou rejoués d'affilée bloquent les vérifications TOTP de ce client pendant 15 minutes. Chaque adresse IP distante dispose aussi de 60 appels par minute au total pour l'état du coffre, sa création, le téléchargement de l'identité, le défi et la session. Les requêtes directes en boucle locale ont une limite TOTP distincte et sont exemptées de la limite d'appels.",
                "Le secret TOTP est stocké en clair dans `data/totp.json` (mode 0600), car le serveur doit pouvoir le lire seul. Le TOTP ne protège pas un disque volé.",
                "Téléphone perdu : lancez `keyfold-server -disable-totp -data ./data` sur la machine du serveur.",
              ],
            },
          ],
        },
        {
          id: "limites",
          title: "Quelles sont les limites à connaître ?",
          blocks: [
            {
              list: [
                "Le serveur parle HTTP en clair et écoute en boucle locale par défaut. Pour les autres appareils, utilisez un proxy inverse TLS sur la même machine. Déclarez son nom d'hôte avec `-allowed-hosts`. Le proxy doit conserver `Host` et ajouter l'adresse IP du client à `X-Forwarded-For`. Le serveur accepte les noms d'hôte de boucle locale et ceux déclarés.",
                "`packaging/` fournit un conteneur, un exemple Compose avec Caddy et une unité systemd. Le minuteur de sauvegarde conserve des archives locales. Leur copie hors de la machine revient à l'opérateur.",
                "Changer le mot de passe principal ré-enveloppe la même identité : les éléments ne sont pas rechiffrés, et une ancienne copie du dossier de données s'ouvre toujours avec l'ancien mot de passe.",
                "La vérification des fuites auprès de Have I Been Pwned est désactivée par défaut. Une fois autorisée dans les Paramètres, elle s'exécute à la demande et n'envoie que les 5 premiers caractères du SHA-1 de chaque mot de passe.",
              ],
            },
          ],
        },
      ],
    },
  },
};

const cli: DocPage = {
  key: "cli",
  updated: "2026-11-26",
  content: {
    en: {
      slug: "cli",
      nav: "CLI",
      title: "kf: the command line for scripts and secrets | Keyfold",
      description:
        "Reference of the kf command line: read one field, run a program with secrets in its environment, fill config templates, generate passwords, import and export.",
      h1: "The kf command line",
      lede: "`kf` is Keyfold's command line tool. It hands a secret to a script or a program without a `.env` file, and it refuses to print a value to a terminal.",
      sections: [
        {
          id: "install",
          title: "How do I install kf and reach the server?",
          blocks: [
            { p: "`kf` builds for Linux and macOS. Build the binary from the repository:" },
            { code: "go build -o bin/kf ./apps/kf" },
            {
              p: "The server URL comes from the `-server` flag, then the `KEYFOLD_SERVER` environment variable, then `http://127.0.0.1:8717`. A URL that is not a loopback address must start with `https://`.",
            },
          ],
        },
        {
          id: "unlock",
          title: "How does unlocking work?",
          blocks: [
            {
              p: "You unlock once, and a local agent keeps the vault open for the commands that follow.",
            },
            {
              list: [
                "`kf init` asks for the master password twice, without echo, and creates the vault. For remote creation, set `KEYFOLD_INSTALL_TOKEN` to the install token from the server log.",
                "`kf unlock [-ttl 1h]` asks for the master password and, if TOTP is enabled, a code. It decrypts the identity and starts a background agent for this server on `$XDG_RUNTIME_DIR/keyfold/agent-<key>.sock` or, if that variable is unset, on `keyfold-<uid>/agent-<key>.sock` in the temp directory. `<key>` comes from the server URL: each server has its own agent, so a local and a remote vault can be unlocked at the same time.",
                "`kf lock` stops the agent for this server.",
              ],
            },
          ],
        },
        {
          id: "commands",
          title: "Which commands does kf have?",
          blocks: [
            {
              table: {
                head: ["Command", "What it does"],
                rows: [
                  ["`kf get <name>`", "Prints the value to stdout. Refused when stdout is a terminal."],
                  [
                    "`kf set <name> [-kind K] [-note N]`",
                    "Reads the value from stdin. Kinds: `login` (default), `token`, `note`, `identity`, `ssh-key`, `ssh-passphrase`. The old value goes to the item history (20 values kept).",
                  ],
                  [
                    "`kf read kf://<name>/<field>`",
                    "Prints one field: `value` (or `password`), `username`, `note`, `url`, `totp` or a custom field name. Refused on a terminal.",
                  ],
                  [
                    "`kf run -env VAR=kf://<name>/<field> -- cmd`",
                    "Runs `cmd` with the secrets in its environment, never in argv or on disk. Exits with the command's code.",
                  ],
                  [
                    "`kf inject -i template [-o out]`",
                    "Replaces every `{{ kf://name/field }}` of the template. The output file is written `0600`. An unknown reference writes nothing.",
                  ],
                  [
                    "`kf generate [-len 24] [-symbols=false] [-words N]`",
                    "Prints a random password, or a passphrase of `N` words from the EFF large wordlist. Stores nothing: pipe it into `kf set`.",
                  ],
                  ["`kf totp <name>`", "Prints the item's current TOTP code."],
                  [
                    "`kf list`",
                    "Prints name, kind, project and environment in four tab-separated columns. Unset fields leave empty columns. Values are never printed.",
                  ],
                  ["`kf rm <name>`", "Deletes an item and its attachments."],
                  [
                    "`kf migrate [-apply]`",
                    "Lists the items stored in an older format; `-apply` rewrites them in the current one.",
                  ],
                ],
              },
            },
          ],
        },
        {
          id: "examples",
          title: "How do I pass a secret to a program?",
          blocks: [
            { p: "Start a program with its database password, without a `.env` file:" },
            { code: "kf run -env DB_PASSWORD=kf://prod-db/password -- ./server" },
            {
              p: "Feed an SSH key passphrase to `ssh-add` through `SSH_ASKPASS`, where `askpass.sh` contains `exec kf get github-key`:",
            },
            { code: "SSH_ASKPASS=./askpass.sh SSH_ASKPASS_REQUIRE=force ssh-add ~/path/to/key" },
          ],
        },
        {
          id: "import-export",
          title: "How do I import from Bitwarden or 1Password?",
          blocks: [
            {
              list: [
                "`kf import -format keyfold|bitwarden-json|1password-1pux|csv <file>` adds the items of an export. CSV reads the Chrome, Firefox, Bitwarden and 1Password headers.",
                "An item already present is skipped; another one with a taken name gets ` (2)`. Payment cards are skipped and listed.",
                "`kf export [-format keyfold|bitwarden-json] [-o file] (-encrypt | -plaintext)` exports every item. `-encrypt` asks a passphrase of at least 16 characters and writes an age file; `-plaintext` must be explicit.",
                "An export is never written to a terminal, and attachments are left out (a warning counts them).",
              ],
            },
          ],
        },
      ],
    },
    fr: {
      slug: "cli",
      nav: "CLI",
      title: "kf : la ligne de commande pour vos scripts | Keyfold",
      description:
        "Référence de kf : lire un champ, lancer un programme avec ses secrets dans l'environnement, remplir des modèles, générer, importer et exporter.",
      h1: "La ligne de commande kf",
      lede: "`kf` est l'outil en ligne de commande de Keyfold. Il passe un secret à un script ou à un programme sans fichier `.env`, et il refuse d'afficher une valeur dans un terminal.",
      sections: [
        {
          id: "installation",
          title: "Comment installer kf et joindre le serveur ?",
          blocks: [
            { p: "`kf` se compile pour Linux et macOS. Compilez le binaire depuis le dépôt :" },
            { code: "go build -o bin/kf ./apps/kf" },
            {
              p: "L'adresse du serveur vient de l'option `-server`, puis de la variable d'environnement `KEYFOLD_SERVER`, puis de `http://127.0.0.1:8717`. Une adresse qui n'est pas en boucle locale doit commencer par `https://`.",
            },
          ],
        },
        {
          id: "deverrouillage",
          title: "Comment fonctionne le déverrouillage ?",
          blocks: [
            {
              p: "Vous déverrouillez une fois, puis un agent local garde le coffre ouvert pour les commandes suivantes.",
            },
            {
              list: [
                "`kf init` demande deux fois le mot de passe principal, sans l'afficher, et crée le coffre. Pour une création à distance, définissez `KEYFOLD_INSTALL_TOKEN` avec le jeton d'installation du journal du serveur.",
                "`kf unlock [-ttl 1h]` demande le mot de passe principal et, si le TOTP est activé, un code. La commande déchiffre l'identité et lance un agent en arrière-plan pour ce serveur sur `$XDG_RUNTIME_DIR/keyfold/agent-<key>.sock` ou, si cette variable est absente, sur `keyfold-<uid>/agent-<key>.sock` dans le dossier temporaire. `<key>` dépend de l'URL du serveur : chaque serveur a son agent, donc un coffre local et un coffre distant peuvent être déverrouillés en même temps.",
                "`kf lock` arrête l'agent de ce serveur.",
              ],
            },
          ],
        },
        {
          id: "commandes",
          title: "Quelles commandes propose kf ?",
          blocks: [
            {
              table: {
                head: ["Commande", "Ce qu'elle fait"],
                rows: [
                  ["`kf get <name>`", "Écrit la valeur sur la sortie standard. Refusée si la sortie est un terminal."],
                  [
                    "`kf set <name> [-kind K] [-note N]`",
                    "Lit la valeur sur l'entrée standard. Types : `login` (par défaut), `token`, `note`, `identity`, `ssh-key`, `ssh-passphrase`. L'ancienne valeur rejoint l'historique de l'élément (20 valeurs gardées).",
                  ],
                  [
                    "`kf read kf://<name>/<field>`",
                    "Écrit un seul champ : `value` (ou `password`), `username`, `note`, `url`, `totp` ou le nom d'un champ personnalisé. Refusée dans un terminal.",
                  ],
                  [
                    "`kf run -env VAR=kf://<name>/<field> -- cmd`",
                    "Lance `cmd` avec les secrets dans son environnement, jamais dans argv ni sur le disque. Se termine avec le code de sortie de la commande.",
                  ],
                  [
                    "`kf inject -i template [-o out]`",
                    "Remplace chaque `{{ kf://name/field }}` du modèle. Le fichier de sortie est écrit en `0600`. Une référence inconnue n'écrit rien.",
                  ],
                  [
                    "`kf generate [-len 24] [-symbols=false] [-words N]`",
                    "Affiche un mot de passe aléatoire, ou une phrase de passe de `N` mots tirés de la grande liste EFF. Ne stocke rien : redirigez-le vers `kf set`.",
                  ],
                  ["`kf totp <name>`", "Affiche le code TOTP courant de l'élément."],
                  [
                    "`kf list`",
                    "Affiche le nom, le type, le projet et l'environnement dans quatre colonnes séparées par des tabulations. Les champs absents laissent des colonnes vides. Les valeurs ne sont jamais affichées.",
                  ],
                  ["`kf rm <name>`", "Supprime un élément et ses pièces jointes."],
                  [
                    "`kf migrate [-apply]`",
                    "Liste les éléments stockés dans un ancien format ; `-apply` les réécrit dans le format courant.",
                  ],
                ],
              },
            },
          ],
        },
        {
          id: "exemples",
          title: "Comment passer un secret à un programme ?",
          blocks: [
            { p: "Lancer un programme avec le mot de passe de sa base, sans fichier `.env` :" },
            { code: "kf run -env DB_PASSWORD=kf://prod-db/password -- ./server" },
            {
              p: "Fournir la phrase de passe d'une clé SSH à `ssh-add` via `SSH_ASKPASS`, où `askpass.sh` contient `exec kf get github-key` :",
            },
            { code: "SSH_ASKPASS=./askpass.sh SSH_ASKPASS_REQUIRE=force ssh-add ~/path/to/key" },
          ],
        },
        {
          id: "import-export",
          title: "Comment importer depuis Bitwarden ou 1Password ?",
          blocks: [
            {
              list: [
                "`kf import -format keyfold|bitwarden-json|1password-1pux|csv <file>` ajoute les éléments d'un export. Le CSV lit les en-têtes de Chrome, Firefox, Bitwarden et 1Password.",
                "Un élément déjà présent est ignoré ; un autre dont le nom est pris reçoit le suffixe ` (2)`. Les cartes de paiement sont ignorées et listées.",
                "`kf export [-format keyfold|bitwarden-json] [-o file] (-encrypt | -plaintext)` exporte tous les éléments. `-encrypt` demande une phrase de passe d'au moins 16 caractères et écrit un fichier age ; `-plaintext` doit être demandé explicitement.",
                "Un export n'est jamais écrit dans un terminal, et les pièces jointes sont laissées de côté (un avertissement les compte).",
              ],
            },
          ],
        },
      ],
    },
  },
};

const mcp: DocPage = {
  key: "mcp",
  updated: "2026-11-26",
  content: {
    en: {
      slug: "mcp",
      nav: "MCP",
      title: "MCP server: a secrets vault for AI agents | Keyfold",
      description:
        "kf mcp gives an AI agent two tools, search and execute: its JavaScript lists items, creates a generated secret, imports a declared env file and reports vault health. No function returns a secret value, and none edits or deletes.",
      h1: "MCP server for AI agents",
      lede: "`kf mcp` is a Model Context Protocol server built into the Keyfold command line. An AI agent can list the vault, create a generated secret, import an env file you declared and read the vault's health, and nothing it calls ever returns a secret value.",
      sections: [
        {
          id: "tools",
          title: "Which tools does the MCP server expose?",
          blocks: [
            {
              p: "Two tools, with or without a deposit key: `search` describes the functions of a `kf` object, and `execute` runs JavaScript that calls them, so one call can chain several operations and return only what the agent needs. The interpreter sees `kf` and `console.log` only: no file, network or process access, 30 seconds and 64 KiB at most. The functions:",
            },
            {
              table: {
                head: ["Function", "What it returns or does"],
                rows: [
                  [
                    "`kf.listItems()`",
                    "The name, kind, optional project and environment, and creation and last modification dates of each item. With a deposit key: the same without dates, from a catalog the web UI writes for the key.",
                  ],
                  [
                    "`kf.generateItem({name, kind})`",
                    "Creates an item holding a random secret, generated and encrypted locally. It refuses a name that already exists. With a deposit key, it refuses a name of the catalog, and the item is deposited: a new name enters the vault when you open it in the web UI, a taken one waits for your choice.",
                  ],
                  [
                    "`kf.importEnv({source, keys})`",
                    "Copies variables of a remote env file into items named `<source>.<KEY>`. Declare the source in `~/.config/keyfold/sources.json` and set optional `project` and `environment` fields for new items. Allowed environments are `prod`, `preprod`, and `local`. Items with an environment use encrypted format v5. kf reads the file over ssh, encrypts the values locally, and returns a status per key only. It never overwrites an item. With a deposit key, the items are deposited: a new name enters the vault when you open it in the web UI, a name that holds another value waits for your choice.",
                  ],
                  [
                    "`kf.vaultHealth()`",
                    "Unlocked vault only. What the server stores (item and attachment counts, sizes, free disk space, TOTP, open sessions) and the dashboard indicators as item names: stale, reused, short, weak, website without TOTP.",
                  ],
                ],
              },
            },
          ],
        },
        {
          id: "safety",
          title: "Why can an agent use it without seeing a secret?",
          blocks: [
            {
              p: "Whatever a script returns enters the model's conversation and its transcripts. So no function returns a value or a note, and none edits or deletes an item.",
            },
            {
              p: "The health rules are the same as the web dashboard's: they exist in Go and in TypeScript, and both test suites check the same cases.",
            },
          ],
        },
        {
          id: "setup",
          title: "How do I connect it to an agent?",
          blocks: [
            {
              p: "`kf mcp` serves `search` and `execute` on stdin and stdout. It uses the local agent, so run `kf unlock` first. To register it in Claude Code, from the repository, after `make build`:",
            },
            { code: 'claude mcp add keyfold -- "$PWD/bin/kf" mcp' },
            {
              p: "Deposit mode: `kf mcp -deposit` serves the same two tools with a deposit key created on the AI page of the web UI instead of the unlocked vault. `kf.generateItem` and `kf.importEnv` encrypt new items for the vault's public key and deposit them; `kf.listItems` reads a catalog of names the web UI writes for the key; `kf.vaultHealth` does not exist. No unlock, and the key cannot read any value. Deposits stay outside the vault until you open it in the web UI: a new name is added, a name that holds another value waits for your choice (replace, keep both, refuse).",
            },
          ],
        },
        {
          id: "programs",
          title: "How does a program get a secret, then?",
          blocks: [
            {
              p: "Through the command line, not through a tool. `kf run` starts a program with the secrets in its environment, never in argv or on disk, and `kf inject` fills a config template (a file written with `-o` gets mode `0600`).",
            },
            { code: "kf run -env DB_PASSWORD=kf://prod-db/password -- ./server" },
          ],
        },
      ],
    },
    fr: {
      slug: "mcp",
      nav: "MCP",
      title: "Serveur MCP : un coffre de secrets pour agents IA | Keyfold",
      description:
        "kf mcp donne deux outils à un agent IA, search et execute : son JavaScript liste le coffre, crée un secret généré, importe un fichier env déclaré et lit l'état du coffre. Aucune fonction ne renvoie de valeur ni ne modifie rien.",
      h1: "Serveur MCP pour agents IA",
      lede: "`kf mcp` est un serveur Model Context Protocol intégré à la ligne de commande de Keyfold. Un agent IA peut lister le coffre, créer un secret généré, importer un fichier env que vous avez déclaré et lire l'état du coffre, et rien de ce qu'il appelle ne renvoie jamais la valeur d'un secret.",
      sections: [
        {
          id: "outils",
          title: "Quels outils le serveur MCP expose-t-il ?",
          blocks: [
            {
              p: "Deux outils, avec ou sans clé de dépôt : `search` décrit les fonctions d'un objet `kf`, et `execute` exécute du JavaScript qui les appelle : un seul appel enchaîne plusieurs opérations et ne renvoie que ce dont l'agent a besoin. L'interpréteur ne voit que `kf` et `console.log` : ni fichier, ni réseau, ni processus, 30 secondes et 64 Kio au plus. Les fonctions :",
            },
            {
              table: {
                head: ["Fonction", "Ce qu'elle renvoie ou fait"],
                rows: [
                  [
                    "`kf.listItems()`",
                    "Le nom, le type, le projet et l'environnement s'ils sont renseignés, ainsi que les dates de création et de dernière modification de chaque élément. Avec une clé de dépôt : la même chose sans les dates, depuis un catalogue que l'interface web écrit pour la clé.",
                  ],
                  [
                    "`kf.generateItem({name, kind})`",
                    "Crée un élément contenant un secret aléatoire, généré et chiffré en local. Elle refuse un nom déjà pris. Avec une clé de dépôt, elle refuse un nom du catalogue, et l'élément est déposé : un nouveau nom entre dans le coffre quand vous l'ouvrez dans l'interface web, un nom déjà pris attend votre choix.",
                  ],
                  [
                    "`kf.importEnv({source, keys})`",
                    "Copie les variables d'un fichier env distant dans des éléments nommés `<source>.<KEY>`. Déclarez la source dans `~/.config/keyfold/sources.json` et renseignez les champs facultatifs `project` et `environment` pour les nouveaux éléments. Les environnements autorisés sont `prod`, `preprod` et `local`. Les éléments avec un environnement utilisent le format chiffré v5. kf lit le fichier par ssh, chiffre les valeurs en local et ne renvoie qu'un statut par clé. Elle n'écrase jamais un élément. Avec une clé de dépôt, les éléments sont déposés : un nouveau nom entre dans le coffre quand vous l'ouvrez dans l'interface web, un nom qui porte une autre valeur attend votre choix.",
                  ],
                  [
                    "`kf.vaultHealth()`",
                    "Coffre déverrouillé seulement. Ce que le serveur stocke (nombre d'éléments et de pièces jointes, tailles, espace disque libre, TOTP, sessions ouvertes) et les indicateurs du tableau de bord, sous forme de noms d'éléments : à renouveler, réutilisé, court, faible, site sans TOTP.",
                  ],
                ],
              },
            },
          ],
        },
        {
          id: "surete",
          title: "Pourquoi un agent peut-il s'en servir sans voir de secret ?",
          blocks: [
            {
              p: "Tout ce qu'un script renvoie entre dans la conversation du modèle et dans ses transcriptions. Aucune fonction ne renvoie donc de valeur ni de note, et aucune ne modifie ni ne supprime d'élément.",
            },
            {
              p: "Les règles de l'état du coffre sont celles du tableau de bord web : elles existent en Go et en TypeScript, et les deux suites de tests vérifient les mêmes cas.",
            },
          ],
        },
        {
          id: "installation",
          title: "Comment le brancher à un agent ?",
          blocks: [
            {
              p: "`kf mcp` sert `search` et `execute` sur l'entrée et la sortie standard. Il passe par l'agent local : lancez d'abord `kf unlock`. Pour l'enregistrer dans Claude Code, depuis le dépôt, après `make build` :",
            },
            { code: 'claude mcp add keyfold -- "$PWD/bin/kf" mcp' },
            {
              p: "Mode dépôt : `kf mcp -deposit` sert les deux mêmes outils avec une clé de dépôt créée sur la page IA de l'interface web au lieu du coffre déverrouillé. `kf.generateItem` et `kf.importEnv` chiffrent les nouveaux éléments pour la clé publique du coffre et les déposent ; `kf.listItems` lit un catalogue des noms que l'interface web écrit pour la clé ; `kf.vaultHealth` n'existe pas. Pas de déverrouillage, et la clé ne peut lire aucune valeur. Les dépôts restent hors du coffre jusqu'à ce que vous l'ouvriez dans l'interface web : un nouveau nom est ajouté, un nom qui porte une autre valeur attend votre choix (remplacer, garder les deux, refuser).",
            },
          ],
        },
        {
          id: "programmes",
          title: "Comment un programme reçoit-il un secret, alors ?",
          blocks: [
            {
              p: "Par la ligne de commande, pas par un outil. `kf run` lance un programme avec les secrets dans son environnement, jamais dans argv ni sur le disque, et `kf inject` remplit un modèle de configuration (un fichier écrit avec `-o` reçoit le mode `0600`).",
            },
            { code: "kf run -env DB_PASSWORD=kf://prod-db/password -- ./server" },
          ],
        },
      ],
    },
  },
};

const selfHosting: DocPage = {
  key: "self-hosting",
  updated: "2026-11-26",
  content: {
    en: {
      slug: "self-hosting",
      nav: "Self-hosting",
      title: "Self-hosting: run your own secrets vault | Keyfold",
      description:
        "Install Keyfold on Linux, connect over HTTPS, create the vault, back it up, test a restore and update it.",
      h1: "Self-hosting Keyfold",
      lede: "Run Keyfold on a Linux machine you control. Set up HTTPS, create your vault and enable its second factor, then back up your data before your first update.",
      sections: [
        {
          id: "components",
          title: "What do I need?",
          blocks: [
            {
              p: "Use a Linux machine with Docker and Compose, or install the binaries and web UI on a Linux host with systemd. Choose a host name that your devices resolve to the HTTPS endpoint. Replace the example names `vault.example.com` for Caddy and `coffre.exemple.ts.net` for Tailscale with yours.",
            },
          ],
        },
        {
          id: "start",
          title: "How do I install Keyfold?",
          blocks: [
            {
              p: "Find the source and releases at https://github.com/dev-toolings/keyfold. When a version tag is pushed, `.github/workflows/release.yml` publishes GitHub release archives named `keyfold_<tag>_<os>_<arch>.tar.gz` and `checksums.txt`. Choose `linux` or `darwin` and `amd64` or `arm64`. All archives include `kf`. Linux archives also include `keyfold-server`, the built `web/` directory and `packaging/`. The workflow publishes `ghcr.io/dev-toolings/keyfold:<version>` for Linux, with the leading `v` removed from the release tag.",
            },
            {
              p: "With Docker, use `packaging/compose.yml` and the adjacent `Caddyfile`. Set the `vault` service's `image` to the tagged GHCR image. Until a release exists, run `make image` from a clone and keep the kit's local image reference. If the printed tag differs from `dev`, set `VERSION` to the part after `keyfold:`. Keep the same Compose project for setup and updates so it reuses the `vault-data` volume mounted at `/data`.",
            },
            {
              p: "With systemd, put `keyfold-server` at `/usr/local/bin/keyfold-server`, the contents of the built web UI in `/usr/local/share/keyfold/web` and `packaging/keyfold.service` at `/etc/systemd/system/keyfold.service`. The unit keeps the vault in `/var/lib/keyfold`. Put `kf` on the command path of the devices that need it. To build from a clone with Go and Bun installed, run `make install`, `make build` and `make web-build`. Use the binaries from `bin/` and the UI from `apps/web/dist`.",
            },
          ],
        },
        {
          id: "private-access",
          title: "How do I set up private HTTPS access?",
          blocks: [
            {
              p: "Prefer private HTTPS access. Keep Keyfold listening on loopback at `127.0.0.1:8717` and put the HTTPS proxy in the same network namespace. With Compose, Caddy shares the vault's loopback and the kit publishes TCP port 443 for HTTPS. Restrict that port to your private network. Use `KEYFOLD_HOST` to set the Caddy host name and populate `KEYFOLD_ALLOWED_HOSTS`. Use the same host name each time you start the stack.",
            },
            { code: "KEYFOLD_HOST=vault.example.com docker compose -f packaging/compose.yml up -d" },
            {
              p: "Trust Caddy's root CA certificate from the `caddy-data` volume on each client device. With systemd, set `KEYFOLD_ALLOWED_HOSTS` in the installed unit to your HTTPS host name. Run Caddy on the same machine, use the site block from `packaging/Caddyfile` with your host name and point it at `127.0.0.1:8717`. Serve HTTPS on port 443 for the private network and trust this Caddy instance's internal CA on each device.",
            },
            { code: "sudo systemctl enable --now keyfold.service" },
            {
              p: "On a host installation you can also use Tailscale Serve (`tailscale serve`). Set `KEYFOLD_ALLOWED_HOSTS` to the HTTPS name of the machine on your tailnet, for example `coffre.exemple.ts.net`, and configure Serve to forward private HTTPS traffic to `http://127.0.0.1:8717`. Run both checks below before using it.",
            },
            {
              p: "The proxy must pass the original `Host`, whose name must be listed in `KEYFOLD_ALLOWED_HOSTS`. It must append the connecting client's IP address to `X-Forwarded-For`.",
            },
            {
              p: "If a proxy on the same machine replaces `Host` with the loopback upstream and sends no forwarding headers, Keyfold treats remote requests as local. Remote clients can then create the vault without the install token, bypass per-client rate limits, and retrieve the encrypted identity without enabling TOTP.",
            },
            {
              p: "Caddy's `reverse_proxy`, used in this kit, does both by default. Once Keyfold is running, check both from another device through the proxy before you create the vault. You can send the GET requests by opening the two paths on your HTTPS host in a browser.",
            },
            { p: "1. Send `GET /api/v1/alive`. HTTP 404 confirms that Keyfold treats the request as remote." },
            {
              p: "2. Send `GET /api/v1/status` because the alive probe is logged at debug level. Read the server access log with `docker compose -f packaging/compose.yml logs vault` for Compose or `journalctl -u keyfold` for systemd. The request's `client` field must show the device's IP address, confirming Keyfold uses the forwarded address. `127.0.0.1` or `::1` indicates the proxy's loopback address.",
            },
          ],
        },
        {
          id: "public-access",
          title: "Can I expose Keyfold on the internet?",
          blocks: [
            {
              p: "Use Caddy with a public DNS name and a publicly trusted certificate. Point the name at the proxy, allow inbound TCP 443, and remove `tls internal` from the Caddy site block. Keep the same upstream and allowed host and run the two proxy checks before creating the vault. If Caddy needs DNS validation, configure the ACME DNS challenge with a DNS provider module as described in `packaging/Caddyfile`.",
            },
            {
              p: "This exposes the web UI and API to anyone on the internet. Protected API routes still require a session. Remote unlock requires TOTP so a client must present a valid code or already have a live session to download the encrypted identity. A copy of that identity allows offline guesses of your master password.",
            },
          ],
        },
        {
          id: "vault",
          title: "How do I create and unlock the vault?",
          blocks: [
            {
              p: "Set a master password of at least 16 characters. Create the vault in the web UI on the server machine, then scan the QR code with your authenticator and confirm with a code. You can also enable the second factor later in Settings on the server machine. While TOTP is off, Keyfold refuses to hand the encrypted identity to a remote client, even if the vault was created remotely.",
            },
            {
              p: "For systemd, open `http://127.0.0.1:8717` directly. On a headless host you can use a local SSH port forward to the server's loopback, then open the forwarded loopback address in your browser. The connection must reach Keyfold with a loopback host and no HTTP forwarding headers.",
            },
            {
              p: "For Docker on Linux, after checking the proxy, take the stack down with the command below. It keeps the named volumes.",
            },
            { code: "docker compose -f packaging/compose.yml down" },
            {
              p: "Temporarily replace the `vault` service's `ports` block with `network_mode: host` in `packaging/compose.yml`. Start only the `vault` service so its loopback is the host's loopback for setup.",
            },
            { code: "KEYFOLD_HOST=vault.example.com docker compose -f packaging/compose.yml up -d vault" },
            {
              p: "Open `http://127.0.0.1:8717` as for a host installation and enable TOTP. Take the stack down again with the same command, restore the original `ports` block in place of `network_mode: host`, then start the full stack with the HTTPS command above. Retest the two proxy checks.",
            },
            {
              p: "If you create the vault remotely, read the single-use `installToken` from the server's startup log using the log command above. A restart before creation generates a new token. When you enter the token in the web form, the web UI sends it in `X-Install-Token`. The vault is created, then the page tries to unlock it and reports that you must enable the second factor on the server machine. Nothing is lost. Do not create the vault again. Open Keyfold over direct loopback as described above, unlock with the same master password and enable TOTP in Settings. Then reload the remote page and unlock with your master password and TOTP code. For remote `kf init`, set `KEYFOLD_INSTALL_TOKEN` to the install token, target the HTTPS URL and complete the same TOTP setup before unlocking remotely.",
            },
            {
              p: "To skip the install token and the loopback step, set up email setup: put `KEYFOLD_OWNER_EMAIL` and the `KEYFOLD_SMTP_*` settings in `/etc/keyfold/keyfold.env` (see `packaging/README.md`) and restart the service. The web form then asks for the owner's email, sends a 6 digit code to it, creates the vault and turns TOTP on from the same device.",
            },
          ],
        },
        {
          id: "connect-cli",
          title: "How do I connect kf from another device?",
          blocks: [
            {
              p: "Install `kf` for the device and make sure it trusts the HTTPS certificate. Choose the URL you configured, for example `https://vault.example.com` or `https://coffre.exemple.ts.net`. The CLI refuses plain HTTP for non-loopback addresses.",
            },
            { code: "export KEYFOLD_SERVER=https://vault.example.com\nkf version\nkf unlock\nkf list" },
            {
              p: "`kf version` prints the local build version and commit, if available. `kf unlock` asks for your master password and TOTP code, then starts a local background agent that holds the decrypted identity. `kf list` uses that agent to access the vault and prints each item's name, kind, project and environment. Run `kf lock` to stop the agent when you finish.",
            },
          ],
        },
        {
          id: "backup-restore",
          title: "How do I back up and restore the vault?",
          blocks: [
            {
              p: "On a host installation, run the backup with sudo to read the vault data. These commands create a new private directory in your home directory and make your account the owner of the 0600 archive.",
            },
            {
              code: 'backup_dir=$(mktemp -d "$HOME/keyfold-backup.XXXXXXXX") &&\nsudo /usr/local/bin/keyfold-server -data /var/lib/keyfold -backup "$backup_dir/vault.tar" &&\nsudo chown "$(id -u):$(id -g)" "$backup_dir/vault.tar"',
            },
            {
              p: "For Compose, run these commands from the directory that contains `packaging/`, using your regular account with Docker access. Compose creates the archive in the writable `/data` volume and copies it into a new private directory under your home directory. By default, the local copy belongs to the account that runs `docker compose cp`. The last command removes the staged archive from the volume after the copy is ready.",
            },
            {
              code: 'backup_dir=$(mktemp -d "$HOME/keyfold-backup.XXXXXXXX") &&\nstaged_archive="/data/$(basename "$backup_dir").tar" &&\ndocker compose -f packaging/compose.yml exec -T vault keyfold-server -data /data -backup "$staged_archive" &&\ndocker compose -f packaging/compose.yml cp "vault:$staged_archive" "$backup_dir/vault.tar" &&\nchmod 600 "$backup_dir/vault.tar" &&\ndocker compose -f packaging/compose.yml exec -T vault rm "$staged_archive"',
            },
            {
              p: "If a step fails after `staged_archive` is set, run this cleanup command in the same shell before retrying the backup.",
            },
            { code: 'docker compose -f packaging/compose.yml exec -T vault rm -f "$staged_archive"' },
            {
              p: "The archive contains the encrypted identity, items and attachments, plus the public recipient, the layout version and `totp.json` in clear if TOTP is configured. An online backup reads whole files, but a concurrent attachment deletion can leave an archived item missing its attachment. Pause writes while backing up before an update. Copy archives regularly to storage off the machine with restricted access.",
            },
            {
              p: "For a host installation, set up the kit's systemd timer from the directory that contains `packaging/`.",
            },
            {
              code: "sudo install -m 0755 packaging/keyfold-backup.sh /usr/local/bin/keyfold-backup\nsudo install -m 0644 packaging/keyfold-backup.service packaging/keyfold-backup.timer /etc/systemd/system/\nsudo systemctl daemon-reload\nsudo systemctl enable --now keyfold-backup.timer",
            },
            {
              p: "The timer runs daily, catches up after downtime and retains up to 14 archives named `keyfold-YYYYMMDDTHHMMSSZ.tar` in UTC. On the host they live in `/var/lib/private/keyfold-backups`, linked from `/var/lib/keyfold-backups`. Once an archive exists, use sudo to list and copy it. When `read` waits for input, enter the name of the archive you want. The copy belongs to your account and has mode 0600.",
            },
            {
              code: 'sudo ls -1 /var/lib/private/keyfold-backups &&\nread -r timer_archive &&\nbackup_dir=$(mktemp -d "$HOME/keyfold-backup.XXXXXXXX") &&\nsudo install -m 600 -o "$(id -u)" -g "$(id -g)" "/var/lib/private/keyfold-backups/$timer_archive" "$backup_dir/vault.tar"',
            },
            {
              p: "For a restore drill on a machine with the binaries and web UI, use the private directory from one of the steps above. If you moved the archive to another machine, set `backup_dir` to the private directory that holds `vault.tar`. Run the restore as your regular user. The `new` directory must be missing or empty.",
            },
            { code: 'keyfold-server -data "$backup_dir/new" -restore "$backup_dir/vault.tar"' },
            {
              p: "Start the restored copy on a separate loopback port. Use the original master password and authenticator, check the item count and open a downloaded attachment. Shut down the drill and remove the restored copy when done. The full README procedure is at https://github.com/dev-toolings/keyfold/blob/main/README.md#restore-drill",
            },
          ],
        },
        {
          id: "update",
          title: "How do I update or roll back?",
          blocks: [
            {
              list: [
                "Read `CHANGELOG.md` for the target version. Back up the vault before upgrading, and keep the previous image tag or release archive available.",
                "For Compose, take the stack down while keeping volumes, replace the vault image tag and start the stack again. With systemd, replace the binaries and web UI with files from the same release, then run `sudo systemctl restart keyfold.service`.",
                "Run `keyfold-server -version` on the host or inside the `vault` container to check the server binary. Run `kf version` on any updated device to check the CLI. Unlock over HTTPS and check that the vault opens.",
                "To roll back, stop the updated server and switch back to the previous version. The data directory records a layout version in `version`. An older server refuses to open a directory with a newer layout. If the layout changed, restore the pre-update archive into a fresh directory or volume, use that data with the previous server, and keep the newer data separate. This restores the vault as it was at backup time.",
              ],
            },
          ],
        },
        {
          id: "limits",
          title: "What limits should I know?",
          blocks: [
            {
              list: [
                "One user and one vault. Keyfold has a web UI and CLI. There is no browser extension or mobile app.",
                "The server is Unix-only and tested on Linux. It serves plain HTTP to the HTTPS proxy.",
                "The TOTP secret is stored in clear in `totp.json` on disk and in backups. Protect both.",
                "Remote rate limits use the full client IP address, including for IPv6. The proxy must preserve `Host` and append the client IP to `X-Forwarded-For`. Keyfold uses the last address in that header when the proxy connects over loopback.",
              ],
            },
          ],
        },
      ],
    },
    fr: {
      slug: "auto-hebergement",
      nav: "Auto-hébergement",
      title: "Auto-hébergement : votre propre coffre de secrets | Keyfold",
      description:
        "Installez Keyfold sur Linux, connectez-vous en HTTPS, créez le coffre, sauvegardez-le, testez sa restauration et mettez-le à jour.",
      h1: "Auto-héberger Keyfold",
      lede: "Installez Keyfold sur une machine Linux que vous contrôlez. Configurez HTTPS, créez votre coffre et activez son second facteur, puis sauvegardez vos données avant la première mise à jour.",
      sections: [
        {
          id: "composants",
          title: "De quoi ai-je besoin ?",
          blocks: [
            {
              p: "Utilisez une machine Linux avec Docker et Compose, ou installez les binaires et l'interface web sur un hôte Linux avec systemd. Choisissez un nom d'hôte que vos appareils résolvent vers le point d'accès HTTPS. Remplacez les noms d'exemple `vault.example.com` pour Caddy et `coffre.exemple.ts.net` pour Tailscale par les vôtres.",
            },
          ],
        },
        {
          id: "demarrage",
          title: "Comment installer Keyfold ?",
          blocks: [
            {
              p: "Le code source et les versions publiées sont disponibles sur https://github.com/dev-toolings/keyfold. Lorsqu'un tag de version est poussé, `.github/workflows/release.yml` publie sur GitHub des archives nommées `keyfold_<tag>_<os>_<arch>.tar.gz` et le fichier `checksums.txt`. Choisissez `linux` ou `darwin`, puis `amd64` ou `arm64`. Toutes les archives incluent `kf`. Celles pour Linux contiennent aussi `keyfold-server`, le dossier `web/` compilé et `packaging/`. Le workflow publie `ghcr.io/dev-toolings/keyfold:<version>` pour Linux en retirant le `v` initial du tag.",
            },
            {
              p: "Avec Docker, utilisez `packaging/compose.yml` et le fichier `Caddyfile` du même dossier. Remplacez l'`image` du service `vault` par l'image GHCR avec son tag. Tant qu'aucune version n'a été publiée, lancez `make image` depuis un clone et gardez la référence à l'image locale du kit. Si le tag affiché diffère de `dev`, donnez à `VERSION` la valeur qui suit `keyfold:`. Gardez le même projet Compose pour la configuration et les mises à jour afin de réutiliser le volume `vault-data` monté dans `/data`.",
            },
            {
              p: "Avec systemd, placez `keyfold-server` dans `/usr/local/bin/keyfold-server`, le contenu de l'interface web compilée dans `/usr/local/share/keyfold/web` et `packaging/keyfold.service` dans `/etc/systemd/system/keyfold.service`. L'unité conserve le coffre dans `/var/lib/keyfold`. Placez `kf` dans le chemin des commandes des appareils qui l'utilisent. Pour compiler depuis un clone avec Go et Bun installés, lancez `make install`, `make build` et `make web-build`. Utilisez les binaires de `bin/` et l'interface web de `apps/web/dist`.",
            },
          ],
        },
        {
          id: "acces-prive",
          title: "Comment configurer un accès HTTPS privé ?",
          blocks: [
            {
              p: "Privilégiez un accès HTTPS privé. Gardez Keyfold à l'écoute en boucle locale sur `127.0.0.1:8717` et placez le proxy HTTPS dans le même espace de noms réseau. Avec Compose, Caddy partage la boucle locale du coffre et le kit publie le port TCP 443 pour HTTPS. Réservez ce port à votre réseau privé. Définissez le nom d'hôte de Caddy avec `KEYFOLD_HOST`, qui renseigne aussi `KEYFOLD_ALLOWED_HOSTS`. Utilisez le même nom à chaque démarrage de la pile Compose.",
            },
            { code: "KEYFOLD_HOST=vault.example.com docker compose -f packaging/compose.yml up -d" },
            {
              p: "Ajoutez le certificat racine de Caddy, issu du volume `caddy-data`, aux certificats de confiance de chaque appareil client. Avec systemd, renseignez votre nom d'hôte HTTPS dans `KEYFOLD_ALLOWED_HOSTS` dans l'unité installée. Lancez Caddy sur la même machine avec le bloc de site de `packaging/Caddyfile`, votre nom d'hôte et la cible `127.0.0.1:8717`. Servez HTTPS sur le port 443 pour le réseau privé et ajoutez l'autorité interne de cette instance de Caddy aux certificats de confiance de chaque appareil.",
            },
            { code: "sudo systemctl enable --now keyfold.service" },
            {
              p: "Sur une installation sur l'hôte, vous pouvez aussi utiliser Tailscale Serve (`tailscale serve`). Donnez à `KEYFOLD_ALLOWED_HOSTS` le nom HTTPS de la machine sur votre réseau Tailscale, par exemple `coffre.exemple.ts.net`, et configurez Serve pour transmettre le trafic HTTPS privé à `http://127.0.0.1:8717`. Faites les deux vérifications ci-dessous avant de l'utiliser.",
            },
            {
              p: "Le proxy doit transmettre le `Host` d'origine, dont le nom doit figurer dans `KEYFOLD_ALLOWED_HOSTS`. Il doit ajouter l'adresse IP du client qui se connecte à la fin de `X-Forwarded-For`.",
            },
            {
              p: "Si un proxy sur la même machine remplace `Host` par la cible en boucle locale et n'envoie aucun en-tête de transfert, Keyfold traite les requêtes distantes comme locales. Les clients distants peuvent alors créer le coffre sans jeton d'installation, contourner les limites par client et récupérer l'identité chiffrée sans activer le TOTP.",
            },
            {
              p: "La directive `reverse_proxy` de Caddy utilisée par ce kit fait les deux par défaut. Une fois Keyfold démarré, vérifiez ces deux points depuis un autre appareil via le proxy avant de créer le coffre. Vous pouvez envoyer les requêtes GET en ouvrant les deux chemins sur votre hôte HTTPS dans un navigateur.",
            },
            {
              p: "1. Envoyez `GET /api/v1/alive`. Le statut HTTP 404 confirme que Keyfold traite la requête comme distante.",
            },
            {
              p: "2. Envoyez `GET /api/v1/status`, car la sonde de vie est journalisée au niveau debug. Lisez le journal d'accès du serveur avec `docker compose -f packaging/compose.yml logs vault` pour Compose, ou `journalctl -u keyfold` pour systemd. Le champ `client` de la requête doit indiquer l'adresse IP de l'appareil, ce qui confirme que Keyfold utilise l'adresse transmise. `127.0.0.1` ou `::1` désigne l'adresse de boucle locale du proxy.",
            },
          ],
        },
        {
          id: "acces-public",
          title: "Puis-je exposer Keyfold sur Internet ?",
          blocks: [
            {
              p: "Utilisez Caddy avec un nom DNS public et un certificat reconnu publiquement. Faites pointer le nom vers le proxy, autorisez le trafic entrant sur le port TCP 443 et retirez `tls internal` du bloc de site de Caddy. Gardez la même cible et le même nom d'hôte autorisé, puis faites les deux vérifications du proxy avant de créer le coffre. Si Caddy a besoin d'une validation DNS, configurez le défi ACME DNS avec un module pour votre fournisseur DNS comme indiqué dans `packaging/Caddyfile`.",
            },
            {
              p: "L'interface web et l'API deviennent accessibles à toute personne sur Internet. Les routes protégées de l'API exigent toujours une session. Le déverrouillage à distance exige le TOTP : un client doit présenter un code valide ou avoir déjà une session active pour télécharger l'identité chiffrée. Une copie de cette identité permet de tenter de deviner votre mot de passe principal hors ligne.",
            },
          ],
        },
        {
          id: "coffre",
          title: "Comment créer et déverrouiller le coffre ?",
          blocks: [
            {
              p: "Choisissez un mot de passe principal d'au moins 16 caractères. Créez le coffre dans l'interface web sur la machine serveur, puis scannez le QR code avec votre application d'authentification et confirmez avec un code. Vous pouvez aussi activer le second facteur plus tard dans les Paramètres sur la machine serveur. Tant que le TOTP est désactivé, Keyfold refuse de remettre l'identité chiffrée à un client distant, même si le coffre a été créé à distance.",
            },
            {
              p: "Avec systemd, ouvrez directement `http://127.0.0.1:8717`. Sur un hôte sans interface graphique, vous pouvez rediriger un port local par SSH vers la boucle locale du serveur, puis ouvrir l'adresse de boucle locale redirigée dans votre navigateur. La connexion doit atteindre Keyfold avec un nom d'hôte de boucle locale et sans en-têtes HTTP de transfert.",
            },
            {
              p: "Avec Docker sur Linux, après avoir vérifié le proxy, arrêtez la pile Compose avec la commande ci-dessous. Elle conserve les volumes nommés.",
            },
            { code: "docker compose -f packaging/compose.yml down" },
            {
              p: "Remplacez temporairement le bloc `ports` du service `vault` par `network_mode: host` dans `packaging/compose.yml`. Lancez uniquement le service `vault` pour qu'il utilise la boucle locale de l'hôte pendant la configuration.",
            },
            { code: "KEYFOLD_HOST=vault.example.com docker compose -f packaging/compose.yml up -d vault" },
            {
              p: "Ouvrez `http://127.0.0.1:8717` comme pour une installation sur l'hôte et activez le TOTP. Arrêtez de nouveau la pile avec la même commande, remettez le bloc `ports` d'origine à la place de `network_mode: host`, puis redémarrez toute la pile avec la commande HTTPS ci-dessus. Refaites les deux vérifications du proxy.",
            },
            {
              p: "Si vous créez le coffre à distance, récupérez le jeton à usage unique `installToken` dans le journal de démarrage du serveur avec la commande de lecture des journaux ci-dessus. Un redémarrage avant la création génère un nouveau jeton. Lorsque vous saisissez le jeton dans le formulaire, l'interface web l'envoie dans `X-Install-Token`. Le coffre est créé, puis la page tente de le déverrouiller et vous indique que vous devez activer la double authentification sur la machine serveur. Rien n'est perdu. Ne créez pas le coffre une seconde fois. Ouvrez Keyfold en boucle locale directe comme indiqué ci-dessus, déverrouillez le coffre avec le même mot de passe principal et activez le TOTP dans les Paramètres. Rechargez ensuite la page distante et déverrouillez le coffre avec votre mot de passe principal et votre code TOTP. Pour `kf init` à distance, donnez le jeton d'installation à `KEYFOLD_INSTALL_TOKEN`, utilisez l'URL HTTPS et suivez la même procédure d'activation du TOTP avant de déverrouiller le coffre à distance.",
            },
            {
              p: "Pour vous passer du jeton et de l'étape en boucle locale, activez la configuration par email : placez `KEYFOLD_OWNER_EMAIL` et les réglages `KEYFOLD_SMTP_*` dans `/etc/keyfold/keyfold.env` (voir `packaging/README.md`) puis redémarrez le service. Le formulaire demande alors l'email du propriétaire, y envoie un code à 6 chiffres, crée le coffre et active le TOTP depuis le même appareil.",
            },
          ],
        },
        {
          id: "connexion-cli",
          title: "Comment connecter kf depuis un autre appareil ?",
          blocks: [
            {
              p: "Installez `kf` sur l'appareil et vérifiez qu'il reconnaît le certificat HTTPS. Choisissez l'URL que vous avez configurée, par exemple `https://vault.example.com` ou `https://coffre.exemple.ts.net`. La CLI refuse HTTP en clair pour les adresses hors boucle locale.",
            },
            { code: "export KEYFOLD_SERVER=https://vault.example.com\nkf version\nkf unlock\nkf list" },
            {
              p: "`kf version` affiche la version locale et le commit, s'il est disponible. `kf unlock` demande votre mot de passe principal et votre code TOTP, puis lance un agent local en arrière-plan qui conserve l'identité déchiffrée. `kf list` utilise cet agent pour accéder au coffre et affiche le nom, le type, le projet et l'environnement de chaque élément. Lancez `kf lock` pour arrêter l'agent quand vous avez terminé.",
            },
          ],
        },
        {
          id: "sauvegarde-restauration",
          title: "Comment sauvegarder et restaurer le coffre ?",
          blocks: [
            {
              p: "Pour une installation sur l'hôte, lancez la sauvegarde avec sudo pour lire les données du coffre. Ces commandes créent un nouveau dossier privé dans votre répertoire personnel et attribuent à votre compte la propriété de l'archive, dont les permissions sont de 0600.",
            },
            {
              code: 'backup_dir=$(mktemp -d "$HOME/keyfold-backup.XXXXXXXX") &&\nsudo /usr/local/bin/keyfold-server -data /var/lib/keyfold -backup "$backup_dir/vault.tar" &&\nsudo chown "$(id -u):$(id -g)" "$backup_dir/vault.tar"',
            },
            {
              p: "Pour Compose, lancez ces commandes depuis le dossier qui contient `packaging/`, avec votre compte habituel disposant d'un accès à Docker. Compose crée l'archive dans le volume accessible en écriture `/data` et la copie dans un nouveau dossier privé de votre répertoire personnel. Par défaut, la copie locale appartient au compte qui lance `docker compose cp`. La dernière commande supprime l'archive temporaire du volume une fois la copie prête.",
            },
            {
              code: 'backup_dir=$(mktemp -d "$HOME/keyfold-backup.XXXXXXXX") &&\nstaged_archive="/data/$(basename "$backup_dir").tar" &&\ndocker compose -f packaging/compose.yml exec -T vault keyfold-server -data /data -backup "$staged_archive" &&\ndocker compose -f packaging/compose.yml cp "vault:$staged_archive" "$backup_dir/vault.tar" &&\nchmod 600 "$backup_dir/vault.tar" &&\ndocker compose -f packaging/compose.yml exec -T vault rm "$staged_archive"',
            },
            {
              p: "Si une étape échoue après la définition de `staged_archive`, lancez cette commande de nettoyage dans le même terminal avant de relancer la sauvegarde.",
            },
            { code: 'docker compose -f packaging/compose.yml exec -T vault rm -f "$staged_archive"' },
            {
              p: "L'archive contient l'identité, les éléments et les pièces jointes chiffrés, ainsi que le destinataire public, la version du format de stockage et `totp.json` en clair si le TOTP est configuré. Une sauvegarde à chaud lit des fichiers entiers, mais si une pièce jointe est supprimée en même temps, elle peut manquer à un élément archivé. Suspendez les écritures pendant la sauvegarde qui précède une mise à jour. Copiez régulièrement les archives ailleurs que sur la machine, dans un espace de stockage à accès restreint.",
            },
            {
              p: "Pour une installation sur l'hôte, installez le minuteur systemd du kit depuis le dossier qui contient `packaging/`.",
            },
            {
              code: "sudo install -m 0755 packaging/keyfold-backup.sh /usr/local/bin/keyfold-backup\nsudo install -m 0644 packaging/keyfold-backup.service packaging/keyfold-backup.timer /etc/systemd/system/\nsudo systemctl daemon-reload\nsudo systemctl enable --now keyfold-backup.timer",
            },
            {
              p: "Le minuteur s'exécute tous les jours, rattrape les exécutions manquées et conserve jusqu'à 14 archives nommées `keyfold-YYYYMMDDTHHMMSSZ.tar` en UTC. Sur l'hôte, elles se trouvent dans `/var/lib/private/keyfold-backups`, accessible par le lien `/var/lib/keyfold-backups`. Dès qu'une archive existe, utilisez sudo pour l'afficher dans la liste et la copier. Lorsque `read` attend une saisie, entrez le nom de l'archive voulue. La copie appartient à votre compte et ses permissions sont de 0600.",
            },
            {
              code: 'sudo ls -1 /var/lib/private/keyfold-backups &&\nread -r timer_archive &&\nbackup_dir=$(mktemp -d "$HOME/keyfold-backup.XXXXXXXX") &&\nsudo install -m 600 -o "$(id -u)" -g "$(id -g)" "/var/lib/private/keyfold-backups/$timer_archive" "$backup_dir/vault.tar"',
            },
            {
              p: "Pour tester une restauration sur une machine équipée des binaires et de l'interface web, utilisez le dossier privé créé à l'une des étapes ci-dessus. Si vous avez transféré l'archive sur une autre machine, donnez à `backup_dir` le chemin du dossier privé contenant `vault.tar`. Lancez la restauration avec votre compte habituel. Le dossier `new` doit être absent ou vide.",
            },
            { code: 'keyfold-server -data "$backup_dir/new" -restore "$backup_dir/vault.tar"' },
            {
              p: "Démarrez la copie restaurée sur un autre port en boucle locale. Utilisez le mot de passe principal et l'application d'authentification d'origine, vérifiez le nombre d'éléments et ouvrez une pièce jointe téléchargée. Arrêtez le serveur de test et supprimez la copie restaurée à la fin. La procédure complète du README est à l'adresse https://github.com/dev-toolings/keyfold/blob/main/README.md#restore-drill",
            },
          ],
        },
        {
          id: "mise-a-jour",
          title: "Comment mettre à jour ou revenir en arrière ?",
          blocks: [
            {
              list: [
                "Lisez `CHANGELOG.md` pour la version visée. Sauvegardez le coffre avant la mise à jour et gardez à disposition le tag de l'image précédente ou son archive de publication.",
                "Avec Compose, arrêtez la pile en gardant les volumes, remplacez le tag de l'image du coffre et relancez la pile. Avec systemd, remplacez les binaires et l'interface web par les fichiers de la même version, puis lancez `sudo systemctl restart keyfold.service`.",
                "Lancez `keyfold-server -version` sur l'hôte ou dans le conteneur `vault` pour vérifier le binaire du serveur. Lancez `kf version` sur chaque appareil mis à jour pour vérifier la CLI. Déverrouillez le coffre en HTTPS et vérifiez qu'il s'ouvre.",
                "Pour revenir en arrière, arrêtez le serveur mis à jour et repassez à la version précédente. Le dossier de données enregistre la version du format de stockage dans `version`. Un ancien serveur refuse d'ouvrir un dossier dont le format est plus récent. Si le format a changé, restaurez l'archive d'avant la mise à jour dans un nouveau dossier ou volume, utilisez ces données avec l'ancien serveur et gardez les données plus récentes à part. Le coffre revient à son état au moment de la sauvegarde.",
              ],
            },
          ],
        },
        {
          id: "limites",
          title: "Quelles limites faut-il connaître ?",
          blocks: [
            {
              list: [
                "Un utilisateur et un coffre. Keyfold propose une interface web et une ligne de commande. Il n'y a ni extension de navigateur ni application mobile.",
                "Le serveur fonctionne uniquement sous Unix et est testé sous Linux. Il répond en HTTP en clair au proxy HTTPS.",
                "Le secret TOTP est conservé en clair dans `totp.json` sur le disque et dans les sauvegardes. Protégez les deux.",
                "Les limites de requêtes à distance s'appliquent à l'adresse IP cliente complète, y compris en IPv6. Le proxy doit conserver `Host` et ajouter l'adresse IP du client à la fin de `X-Forwarded-For`. Keyfold utilise la dernière adresse de cet en-tête quand le proxy se connecte en boucle locale.",
              ],
            },
          ],
        },
      ],
    },
  },
};

/** Order of the navigation and of the sitemap. */
export const PAGES: DocPage[] = [security, cli, mcp, selfHosting];
