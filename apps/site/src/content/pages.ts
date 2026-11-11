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
                  ["The TOTP secret, when the second factor is on", "An item name"],
                ],
              },
            },
            {
              p: "Its logs hold one line per request with the method, the path, the status and the duration: never a header, a body or a query string.",
            },
          ],
        },
        {
          id: "master-password",
          title: "Why does the master password matter so much?",
          blocks: [
            {
              p: "The encrypted identity can be downloaded by anyone who reaches the server: `GET /api/v1/identity` needs no session, since it exposes no more than a stolen disk would. The strength of the master password is what protects the vault against an offline attack.",
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
                "API access needs a session token, obtained by decrypting a random challenge with the identity.",
                "Tokens and challenges live in server memory only, with a 15 minute idle expiry. A server restart locks every client.",
                "The web UI keeps the identity and the token in memory only. A copied secret is cleared from the clipboard after 30 seconds.",
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
              p: "The TOTP second factor is optional. With it on, the encrypted identity is only handed out against a valid code, so nobody who merely reaches the server can download it for an offline attack.",
            },
            {
              list: [
                "A code works once. Five wrong codes in a row lock every check for 15 minutes.",
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
                "TLS: the server speaks plain HTTP and must stay on `127.0.0.1`.",
                "Backups of the data directory are not handled.",
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
                  ["Le secret TOTP, si le second facteur est activé", "Le nom d'un élément"],
                ],
              },
            },
            {
              p: "Ses journaux contiennent une ligne par requête avec la méthode, le chemin, le statut et la durée : jamais d'en-tête, de corps ni de chaîne de requête.",
            },
          ],
        },
        {
          id: "mot-de-passe-principal",
          title: "Pourquoi le mot de passe principal compte-t-il autant ?",
          blocks: [
            {
              p: "L'identité chiffrée peut être téléchargée par quiconque atteint le serveur : `GET /api/v1/identity` ne demande pas de session, car il n'expose rien de plus qu'un disque volé. C'est la robustesse du mot de passe principal qui protège le coffre contre une attaque hors ligne.",
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
                "L'accès à l'API demande un jeton de session, obtenu en déchiffrant un défi aléatoire avec l'identité.",
                "Les jetons et les défis ne vivent que dans la mémoire du serveur, avec une expiration après 15 minutes d'inactivité. Un redémarrage du serveur verrouille tous les clients.",
                "L'interface web garde l'identité et le jeton en mémoire seulement. Un secret copié est effacé du presse-papiers après 30 secondes.",
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
              p: "Le second facteur TOTP est optionnel. Une fois activé, l'identité chiffrée n'est remise que contre un code valide : quelqu'un qui atteint seulement le serveur ne peut plus la télécharger pour une attaque hors ligne.",
            },
            {
              list: [
                "Un code ne sert qu'une fois. Cinq codes faux d'affilée bloquent toute vérification pendant 15 minutes.",
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
                "TLS : le serveur parle HTTP en clair et doit rester sur `127.0.0.1`.",
                "Les sauvegardes du dossier de données ne sont pas prises en charge.",
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
  updated: "2026-11-11",
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
            { p: "Build the binary from the repository:" },
            { code: "go build -o bin/kf ./apps/kf" },
            {
              p: "The server URL comes from the `-server` flag, then the `KEYFOLD_SERVER` environment variable, then `http://127.0.0.1:8717`.",
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
                "`kf init` asks the master password twice, without echo, and creates the vault.",
                "`kf unlock [-ttl 1h]` asks the master password, decrypts the identity and starts a background agent on `$XDG_RUNTIME_DIR/keyfold/agent.sock`.",
                "`kf lock` stops the agent.",
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
                  ["`kf list`", "Names and kinds, never values."],
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
            { p: "Compilez le binaire depuis le dépôt :" },
            { code: "go build -o bin/kf ./apps/kf" },
            {
              p: "L'adresse du serveur vient de l'option `-server`, puis de la variable d'environnement `KEYFOLD_SERVER`, puis de `http://127.0.0.1:8717`.",
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
                "`kf init` demande deux fois le mot de passe principal, sans l'afficher, et crée le coffre.",
                "`kf unlock [-ttl 1h]` demande le mot de passe principal, déchiffre l'identité et lance un agent en arrière-plan sur `$XDG_RUNTIME_DIR/keyfold/agent.sock`.",
                "`kf lock` arrête l'agent.",
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
                  ["`kf list`", "Les noms et les types, jamais les valeurs."],
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
  updated: "2026-11-11",
  content: {
    en: {
      slug: "mcp",
      nav: "MCP",
      title: "MCP server: a secrets vault for AI agents | Keyfold",
      description:
        "kf mcp gives an AI agent three tools: list items, create a generated secret, report vault health. No tool returns a secret value, and none edits or deletes.",
      h1: "MCP server for AI agents",
      lede: "`kf mcp` is a Model Context Protocol server built into the Keyfold command line. An AI agent can list the vault, create a generated secret and read the vault's health, and no tool ever returns a secret value.",
      sections: [
        {
          id: "tools",
          title: "Which tools does the MCP server expose?",
          blocks: [
            {
              table: {
                head: ["Tool", "What it returns or does"],
                rows: [
                  ["`list_items`", "The name, kind, creation date and last modification date of each item."],
                  [
                    "`generate_item`",
                    "Creates an item holding a random secret, generated and encrypted locally. It refuses a name that already exists.",
                  ],
                  [
                    "`vault_health`",
                    "What the server stores (item and attachment counts, sizes, free disk space, TOTP, open sessions) and the dashboard indicators as item names: stale, reused, short, weak, website without TOTP.",
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
              p: "Whatever a tool returns enters the model's conversation and its transcripts. So no tool returns a value or a note, and none edits or deletes an item.",
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
              p: "`kf mcp` serves its tools on stdin and stdout. It uses the local agent, so run `kf unlock` first. To register it in Claude Code, from the repository, after `make build`:",
            },
            { code: 'claude mcp add keyfold -- "$PWD/bin/kf" mcp' },
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
        "kf mcp donne trois outils à un agent IA : lister, créer un secret généré, lire l'état du coffre. Aucun outil ne renvoie de valeur ni ne modifie rien.",
      h1: "Serveur MCP pour agents IA",
      lede: "`kf mcp` est un serveur Model Context Protocol intégré à la ligne de commande de Keyfold. Un agent IA peut lister le coffre, créer un secret généré et lire l'état du coffre, et aucun outil ne renvoie jamais la valeur d'un secret.",
      sections: [
        {
          id: "outils",
          title: "Quels outils le serveur MCP expose-t-il ?",
          blocks: [
            {
              table: {
                head: ["Outil", "Ce qu'il renvoie ou fait"],
                rows: [
                  [
                    "`list_items`",
                    "Le nom, le type, la date de création et la date de dernière modification de chaque élément.",
                  ],
                  [
                    "`generate_item`",
                    "Crée un élément contenant un secret aléatoire, généré et chiffré en local. Il refuse un nom déjà pris.",
                  ],
                  [
                    "`vault_health`",
                    "Ce que le serveur stocke (nombre d'éléments et de pièces jointes, tailles, espace disque libre, TOTP, sessions ouvertes) et les indicateurs du tableau de bord, sous forme de noms d'éléments : à renouveler, réutilisé, court, faible, site sans TOTP.",
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
              p: "Tout ce qu'un outil renvoie entre dans la conversation du modèle et dans ses transcriptions. Aucun outil ne renvoie donc de valeur ni de note, et aucun ne modifie ni ne supprime d'élément.",
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
              p: "`kf mcp` sert ses outils sur l'entrée et la sortie standard. Il passe par l'agent local : lancez d'abord `kf unlock`. Pour l'enregistrer dans Claude Code, depuis le dépôt, après `make build` :",
            },
            { code: 'claude mcp add keyfold -- "$PWD/bin/kf" mcp' },
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
  updated: "2026-11-11",
  content: {
    en: {
      slug: "self-hosting",
      nav: "Self-hosting",
      title: "Self-hosting: run your own secrets vault | Keyfold",
      description:
        "Run Keyfold on your own machine: one Go server, a data directory of encrypted files, a web UI and a command line. What to start, and the limits to know first.",
      h1: "Self-hosting Keyfold",
      lede: "Keyfold runs on your own machine: one Go server that stores encrypted files in a data directory, with a web UI and a command line. Nothing is hosted for you.",
      sections: [
        {
          id: "components",
          title: "What do I run?",
          blocks: [
            {
              table: {
                head: ["Part", "Role"],
                rows: [
                  [
                    "`keyfold-server`",
                    "The vault HTTP server. It stores encrypted files in a data directory and can serve the web UI.",
                  ],
                  ["`kf`", "The command line tool, with the MCP server for AI agents."],
                  ["Web UI", "A React app, built as static files, opened in the browser."],
                ],
              },
            },
            {
              p: "All three share one vault. The repository holds one Go module and one Bun workspace; `make help` lists every command.",
            },
          ],
        },
        {
          id: "start",
          title: "How do I start the server?",
          blocks: [
            { p: "With its defaults, the server listens on `127.0.0.1:8717` and keeps its data in `./data`:" },
            { code: "go run ./apps/keyfold-server" },
            { p: "Each default has a flag, and `-web` serves the built web UI when the directory exists:" },
            { code: "go run ./apps/keyfold-server -listen 127.0.0.1:8717 -data ./data -web ./apps/web/dist" },
            {
              p: "`make build` builds the `kf` and `keyfold-server` binaries into `bin/`, and `make web-build` builds the web UI into `apps/web/dist`.",
            },
          ],
        },
        {
          id: "vault",
          title: "How do I create the vault?",
          blocks: [
            {
              list: [
                "Create it in the web UI or with `kf init`. The master password must be at least 16 characters.",
                "The TOTP second factor is optional. It is offered right after the vault is created, and later in Settings, where the master password can also be changed.",
                "The vault app lives under `/personal`: unlock, dashboard, vault, health and settings.",
              ],
            },
          ],
        },
        {
          id: "web-ui",
          title: "What does the web UI give me?",
          blocks: [
            {
              list: [
                "An item sheet holds an identifier, the secret, web addresses, a TOTP secret with its live code, custom fields, a note, a folder, a favorite flag, attachments and the 20 previous values, each one restorable.",
                "The generator makes 24 character passwords or 6 word EFF passphrases.",
                "The dashboard lists items to renew, reused values, short passwords, weak passwords (estimated entropy under 60 bits) and websites without a TOTP secret.",
                "The health page shows what the server stores: item and attachment counts, sizes, free disk space, TOTP and open sessions.",
                "Attachments go up to 100 MiB each by default, a limit set by `keyfold-server -max-blob`.",
              ],
            },
          ],
        },
        {
          id: "logs",
          title: "What does the server log?",
          blocks: [
            {
              p: "Logs go to stdout, one line per request, with a `requestId` that is also sent as the `X-Request-Id` header. They are JSON by default; `KEYFOLD_ENV=development` prints colored one-line logs instead, and `NO_COLOR=1` removes the colors.",
            },
            { p: "Only the method, the path, the status and the duration are logged." },
          ],
        },
        {
          id: "limits",
          title: "What is not done yet?",
          blocks: [
            {
              list: [
                "TLS: the server speaks plain HTTP and must stay on `127.0.0.1`.",
                "Hosting: there is no service unit, container or reverse proxy setup.",
                "Backups of the data directory are yours to make.",
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
        "Faites tourner Keyfold sur votre machine : un serveur Go, un dossier de fichiers chiffrés, une interface web et une CLI. Quoi lancer, et ses limites.",
      h1: "Auto-héberger Keyfold",
      lede: "Keyfold tourne sur votre propre machine : un serveur Go qui range des fichiers chiffrés dans un dossier de données, avec une interface web et une ligne de commande. Rien n'est hébergé pour vous.",
      sections: [
        {
          id: "composants",
          title: "Que faut-il lancer ?",
          blocks: [
            {
              table: {
                head: ["Partie", "Rôle"],
                rows: [
                  [
                    "`keyfold-server`",
                    "Le serveur HTTP du coffre. Il range des fichiers chiffrés dans un dossier de données et peut servir l'interface web.",
                  ],
                  ["`kf`", "L'outil en ligne de commande, avec le serveur MCP pour les agents IA."],
                  [
                    "Interface web",
                    "Une application React, construite en fichiers statiques, ouverte dans le navigateur.",
                  ],
                ],
              },
            },
            {
              p: "Les trois partagent un même coffre. Le dépôt contient un module Go et un espace de travail Bun ; `make help` liste toutes les commandes.",
            },
          ],
        },
        {
          id: "demarrage",
          title: "Comment démarrer le serveur ?",
          blocks: [
            {
              p: "Avec ses valeurs par défaut, le serveur écoute sur `127.0.0.1:8717` et garde ses données dans `./data` :",
            },
            { code: "go run ./apps/keyfold-server" },
            {
              p: "Chaque valeur a son option, et `-web` sert l'interface web construite quand le dossier existe :",
            },
            { code: "go run ./apps/keyfold-server -listen 127.0.0.1:8717 -data ./data -web ./apps/web/dist" },
            {
              p: "`make build` construit les binaires `kf` et `keyfold-server` dans `bin/`, et `make web-build` construit l'interface web dans `apps/web/dist`.",
            },
          ],
        },
        {
          id: "coffre",
          title: "Comment créer le coffre ?",
          blocks: [
            {
              list: [
                "Créez-le dans l'interface web ou avec `kf init`. Le mot de passe principal doit faire au moins 16 caractères.",
                "Le second facteur TOTP est optionnel. Il est proposé juste après la création du coffre, puis dans les Paramètres, où l'on change aussi le mot de passe principal.",
                "L'application du coffre vit sous `/personal` : déverrouillage, tableau de bord, coffre, état du système et paramètres.",
              ],
            },
          ],
        },
        {
          id: "interface-web",
          title: "Que m'apporte l'interface web ?",
          blocks: [
            {
              list: [
                "Une fiche d'élément contient un identifiant, le secret, des adresses web, un secret TOTP avec son code en direct, des champs personnalisés, une note, un dossier, un favori, des pièces jointes et les 20 valeurs précédentes, chacune restaurable.",
                "Le générateur produit des mots de passe de 24 caractères ou des phrases de passe EFF de 6 mots.",
                "Le tableau de bord liste les éléments à renouveler, les valeurs réutilisées, les mots de passe courts, les mots de passe faibles (entropie estimée sous 60 bits) et les sites sans secret TOTP.",
                "La page d'état du système montre ce que le serveur stocke : nombre d'éléments et de pièces jointes, tailles, espace disque libre, TOTP et sessions ouvertes.",
                "Les pièces jointes vont jusqu'à 100 Mio chacune par défaut, une limite réglée par `keyfold-server -max-blob`.",
              ],
            },
          ],
        },
        {
          id: "journaux",
          title: "Que journalise le serveur ?",
          blocks: [
            {
              p: "Les journaux partent sur la sortie standard, une ligne par requête, avec un `requestId` renvoyé aussi dans l'en-tête `X-Request-Id`. Ils sont en JSON par défaut ; `KEYFOLD_ENV=development` affiche à la place des lignes colorées, et `NO_COLOR=1` retire les couleurs.",
            },
            { p: "Seuls la méthode, le chemin, le statut et la durée sont journalisés." },
          ],
        },
        {
          id: "limites",
          title: "Qu'est-ce qui n'est pas encore fait ?",
          blocks: [
            {
              list: [
                "TLS : le serveur parle HTTP en clair et doit rester sur `127.0.0.1`.",
                "Hébergement : il n'y a ni unité de service, ni conteneur, ni configuration de proxy inverse.",
                "Les sauvegardes du dossier de données restent à votre charge.",
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
