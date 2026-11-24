// Copy of the product landing page, in French (default, "/") and English ("/en").

export type Lang = "fr" | "en";

export type Feature = {
  id: "dashboard" | "cli" | "mcp" | "crypto";
  title: string;
  tags: [string, string, string];
  description: string;
  link: { label: string; to: string };
};

export type Content = {
  title: string;
  /** Meta and Open Graph description, under 160 characters. */
  description: string;
  nav: { features: string; security: string; stack: string };
  open: string;
  /** Primary call to action on the public site, which has no vault: the source to self-host. */
  getIt: string;
  heroLine1: string;
  heroLine2: string;
  badge: string;
  heroSub: string;
  seeFeatures: string;
  command: string;
  chipLabel: string;
  chipValue: string;
  stackCaption: string;
  sectionLine1: string;
  sectionLine2: string;
  seeVault: string;
  previous: string;
  next: string;
  features: Feature[];
  securityTitle: string;
  security: { title: string; text: string }[];
  /** One plain sentence saying what the product is, easy to quote. */
  definition: string;
  faqTitle: string;
  /** Rendered as the FAQ section and as its FAQPage JSON-LD. */
  faq: { question: string; answer: string }[];
  footer: string;
  otherLang: { label: string; to: string };
};

export const STACK = ["age", "Go", "React", "Tailwind CSS", "shadcn/ui", "MCP"];

export const CONTENT: Record<Lang, Content> = {
  fr: {
    title: "Keyfold, votre coffre de secrets auto-hébergé",
    description:
      "Coffre de secrets auto-hébergé pour mots de passe, jetons d'API et phrases de passe SSH. Chiffré avec age avant de quitter votre machine. CLI et serveur MCP.",
    nav: { features: "Fonctions", security: "Sécurité", stack: "Technique" },
    open: "Ouvrir le coffre",
    getIt: "Héberger le vôtre",
    heroLine1: "Vos secrets chez vous,",
    heroLine2: "lisibles par vous seul.",
    badge: "& auto-hébergé",
    heroSub:
      "Un coffre pour vos mots de passe, jetons d'API et phrases de passe SSH, que vous hébergez vous-même. Tout est chiffré avant de quitter votre machine : le serveur ne voit jamais un secret.",
    seeFeatures: "Voir les fonctions",
    command: "kf unlock && kf get ssh/prod-web-01",
    chipLabel: "Chiffrement",
    chipValue: "age",
    stackCaption: "Construit sur des briques ouvertes, sans service en ligne.",
    sectionLine1: "Quand un fichier de mots",
    sectionLine2: "de passe ne suffit plus.",
    seeVault: "Voir le coffre",
    previous: "Fonction précédente",
    next: "Fonction suivante",
    features: [
      {
        id: "dashboard",
        title: "Tableau de bord",
        tags: ["Santé", "Indicateurs", "Graphiques"],
        description:
          "Voyez d'un coup d'œil les secrets à renouveler, les valeurs réutilisées et les mots de passe trop courts. Tout est calculé dans votre navigateur, à partir de vos seules données.",
        link: { label: "Voir le tableau de bord", to: "/personal/dashboard" },
      },
      {
        id: "cli",
        title: "CLI et agent local",
        tags: ["SSH", "Scripts", "Sans affichage"],
        description:
          "La commande kf get transmet une phrase de passe à un script via la sortie standard et refuse d'écrire dans un terminal. Un agent local garde le coffre ouvert pour une durée limitée.",
        link: { label: "Lire la référence de kf", to: "/cli" },
      },
      {
        id: "mcp",
        title: "MCP pour agents IA",
        tags: ["Claude Code", "Sans valeur", "Génération"],
        description:
          "Un agent IA liste vos éléments et crée des secrets aléatoires. Les outils peuvent renvoyer des noms d'éléments, mais aucune valeur ni note.",
        link: { label: "Voir les outils MCP", to: "/mcp" },
      },
      {
        id: "crypto",
        title: "Chiffrement côté client",
        tags: ["age", "X25519", "scrypt"],
        description:
          "Les éléments et les pièces jointes sont stockés chiffrés. Votre mot de passe principal protège l'identité du coffre et reste sur votre appareil.",
        link: { label: "Lire le modèle de sécurité", to: "/securite" },
      },
    ],
    securityTitle: "Ce que le serveur ne peut pas faire.",
    security: [
      {
        title: "Lire un secret",
        text: "Les éléments et les pièces jointes lui parviennent chiffrés avec age. La clé de déchiffrement reste côté client.",
      },
      {
        title: "Connaître votre mot de passe",
        text: "Le mot de passe principal déchiffre votre identité sur votre poste. Il n'est jamais envoyé.",
      },
      {
        title: "Garder une session",
        text: "Les sessions vivent en mémoire. Elles expirent après 15 minutes d'inactivité ou 12 heures après leur création, et disparaissent au redémarrage.",
      },
    ],
    definition:
      "Keyfold est un coffre de secrets auto-hébergé pour une seule personne : mots de passe, jetons d'API et phrases SSH chiffrés avec age, depuis le web, la CLI kf ou un agent IA.",
    faqTitle: "Questions fréquentes.",
    faq: [
      {
        question: "Keyfold est-il open source et auto-hébergé ?",
        answer:
          "Vous lancez vous-même le serveur Go (keyfold-server), réservé à Unix et testé sur Linux. Il garde les éléments et pièces jointes chiffrés dans un dossier de données local. Le code source est public sur GitHub (dev-toolings/keyfold) sous licence GNU AGPL version 3. Il n'y a ni service en ligne ni compte à créer.",
      },
      {
        question: "Que peut-on y ranger ?",
        answer:
          "Des identifiants, des jetons d'API, des notes, des identités, des clés SSH et des phrases de passe SSH. Chaque élément peut porter des adresses web, un secret TOTP, des champs personnalisés, un dossier, des pièces jointes chiffrées et ses 20 valeurs précédentes.",
      },
      {
        question: "Comment mes secrets sont-ils chiffrés ?",
        answer:
          "Avec age, dans votre navigateur ou dans la CLI kf, avant d'atteindre le serveur. L'identité du coffre est une clé age X25519, elle-même chiffrée par votre mot de passe principal avec le destinataire scrypt de age. Chaque élément, nom compris, est un fichier age distinct chiffré pour cette identité.",
      },
      {
        question: "Le serveur peut-il lire mes mots de passe ?",
        answer:
          "Les mots de passe sont chiffrés côté client. Le serveur ne reçoit ni le mot de passe principal ni l'identité déchiffrée. Une copie de l'identité chiffrée permet d'essayer des mots de passe hors ligne, d'où le minimum de 16 caractères à la création. Le TOTP doit être activé pour télécharger cette identité à distance. Une fois activé, il faut un code valide ou une session active.",
      },
      {
        question: "Un agent IA peut-il l'utiliser sans risque ?",
        answer:
          "Oui, dans des limites fixées par conception. kf mcp est un serveur MCP à trois outils (list_items, generate_item, vault_health) : aucun ne renvoie une valeur ou une note, aucun ne modifie ni ne supprime un élément. Pour donner un secret à un programme, kf run -env VAR=kf://nom/champ -- commande le place dans l'environnement de la commande, jamais dans ses arguments ni sur disque.",
      },
      {
        question: "Comment importer depuis Bitwarden ou 1Password ?",
        answer:
          "Avec la CLI : kf import -format bitwarden-json pour un export JSON de Bitwarden, -format 1password-1pux pour un export .1pux de 1Password, ou -format csv pour les CSV de Chrome, Firefox, Bitwarden et 1Password. Un élément déjà présent est ignoré, et les cartes de paiement sont ignorées puis listées. La CLI exporte uniquement en JSON Keyfold ou Bitwarden. L'interface web ne propose pas l'import.",
      },
      {
        question: "Quelle différence avec 1Password ou Bitwarden ?",
        answer:
          "Le périmètre est plus petit : une seule personne, un coffre auto-hébergé, une interface web, une CLI et un serveur MCP. Le dépôt ne contient ni extension de navigateur, ni application mobile, ni partage entre utilisateurs. Il vise l'usage développeur : kf run, kf inject, des phrases de passe SSH pour les scripts et des outils MCP qui ne renvoient jamais une valeur.",
      },
      {
        question: "Comment accéder au coffre depuis un autre appareil ?",
        answer:
          "Le serveur parle HTTP en clair et écoute en boucle locale par défaut. Pour les autres appareils, utilisez un proxy inverse TLS sur la même machine. Déclarez son nom d'hôte avec -allowed-hosts. Le proxy doit conserver Host et ajouter l'adresse IP du client à X-Forwarded-For. packaging/ fournit un conteneur, un exemple Compose avec Caddy et une unité systemd. Son minuteur de sauvegarde conserve des archives locales, pièces jointes comprises.",
      },
    ],
    footer: "Logiciel auto-hébergé, sans service en ligne.",
    otherLang: { label: "English", to: "/en" },
  },
  en: {
    title: "Keyfold, your self-hosted secrets vault",
    description:
      "Self-hosted secrets vault for passwords, API tokens and SSH passphrases. Encrypted with age before it leaves your machine. CLI and MCP server included.",
    nav: { features: "Features", security: "Security", stack: "Stack" },
    open: "Open the vault",
    getIt: "Host your own",
    heroLine1: "Your secrets at home,",
    heroLine2: "readable by you alone.",
    badge: "& self-hosted",
    heroSub:
      "A vault for your passwords, API tokens and SSH passphrases that you host yourself. Everything is encrypted before it leaves your machine: the server never sees a secret.",
    seeFeatures: "See the features",
    command: "kf unlock && kf get ssh/prod-web-01",
    chipLabel: "Encryption",
    chipValue: "age",
    stackCaption: "Built on open building blocks, with no online service.",
    sectionLine1: "When a password file",
    sectionLine2: "is no longer enough.",
    seeVault: "See the vault",
    previous: "Previous feature",
    next: "Next feature",
    features: [
      {
        id: "dashboard",
        title: "Dashboard",
        tags: ["Health", "Indicators", "Charts"],
        description:
          "See at a glance which secrets need renewing, which values are reused and which passwords are too short. Everything is computed in your browser, from your own data only.",
        link: { label: "See the dashboard", to: "/personal/dashboard" },
      },
      {
        id: "cli",
        title: "CLI and local agent",
        tags: ["SSH", "Scripts", "Never printed"],
        description:
          "The kf get command passes a passphrase to a script through stdout and refuses to write to a terminal. A local agent keeps the vault open for a limited time.",
        link: { label: "Read the kf reference", to: "/en/cli" },
      },
      {
        id: "mcp",
        title: "MCP for AI agents",
        tags: ["Claude Code", "No values", "Generation"],
        description:
          "An AI agent lists your items and creates random secrets. The tools can return item names and never return values or notes.",
        link: { label: "See the MCP tools", to: "/en/mcp" },
      },
      {
        id: "crypto",
        title: "Client-side encryption",
        tags: ["age", "X25519", "scrypt"],
        description:
          "Items and attachments are stored encrypted. Your master password protects the vault identity and stays on your device.",
        link: { label: "Read the security model", to: "/en/security" },
      },
    ],
    securityTitle: "What the server cannot do.",
    security: [
      {
        title: "Read a secret",
        text: "Items and attachments reach the server encrypted with age. The decryption key stays on the client.",
      },
      {
        title: "Know your password",
        text: "The master password decrypts your identity on your computer. It is never sent.",
      },
      {
        title: "Keep a session",
        text: "Sessions live in memory. They expire after 15 minutes of inactivity or 12 hours from creation, and are lost on restart.",
      },
    ],
    definition:
      "Keyfold is a self-hosted secrets vault for one person: passwords, API tokens and SSH passphrases encrypted with age, from the web, the kf CLI or an AI agent.",
    faqTitle: "Frequently asked questions.",
    faq: [
      {
        question: "Is Keyfold open source and self-hosted?",
        answer:
          "You run the Go server (keyfold-server) yourself. It is Unix-only and tested on Linux. It keeps encrypted items and attachments in a local data directory. The source code is public on GitHub (dev-toolings/keyfold) under the GNU AGPL version 3. There is no online service and no account to create.",
      },
      {
        question: "What can I store in it?",
        answer:
          "Logins, API tokens, notes, identities, SSH keys and SSH passphrases. Each item can hold web addresses, a TOTP secret, custom fields, a folder, encrypted attachments and its 20 previous values.",
      },
      {
        question: "How are my secrets encrypted?",
        answer:
          "With age, in your browser or in the kf CLI, before anything reaches the server. The vault identity is an X25519 age key, itself encrypted with your master password through the age scrypt recipient. Each item, its name included, is a separate age file encrypted to that identity.",
      },
      {
        question: "Can the server read my passwords?",
        answer:
          "Passwords are encrypted on the client. The server never receives the master password or the decrypted identity. A copy of the encrypted identity lets someone try passwords offline, which is why a new vault needs a master password of at least 16 characters. TOTP must be enabled to download that identity remotely. Once enabled, a valid code or a live session is required.",
      },
      {
        question: "Can AI agents use it safely?",
        answer:
          "Yes, within limits set by design. kf mcp is an MCP server with three tools (list_items, generate_item, vault_health): none returns a value or a note, and none edits or deletes an item. To hand a secret to a program, kf run -env VAR=kf://name/field -- command puts it in that command's environment, never in its arguments or on disk.",
      },
      {
        question: "How do I import from Bitwarden or 1Password?",
        answer:
          "With the CLI: kf import -format bitwarden-json for a Bitwarden JSON export, -format 1password-1pux for a 1Password .1pux export, or -format csv for CSV files from Chrome, Firefox, Bitwarden and 1Password. An item already present is skipped, and payment cards are skipped and listed. The CLI exports only Keyfold JSON or Bitwarden JSON. The web UI does not offer import.",
      },
      {
        question: "How does it compare with 1Password or Bitwarden?",
        answer:
          "Its scope is smaller: one person, one self-hosted vault, a web UI, a CLI and an MCP server. The repository has no browser extension, no mobile app and no sharing between users. It targets developer use: kf run, kf inject, SSH passphrases for scripts and MCP tools that never return a value.",
      },
      {
        question: "How do I reach the vault from another device?",
        answer:
          "The server speaks plain HTTP and listens on loopback by default. For other devices, use a TLS reverse proxy on the same machine. Declare its host with -allowed-hosts and have the proxy preserve Host and append the client IP to X-Forwarded-For. packaging/ includes a container, a Compose example with Caddy and a systemd unit. Its backup timer keeps local archives, including attachments.",
      },
    ],
    footer: "Self-hosted software, with no online service.",
    otherLang: { label: "Français", to: "/" },
  },
};
