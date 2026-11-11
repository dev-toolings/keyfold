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
          "La commande kf get donne une phrase de passe à un script sans jamais l'écrire dans un terminal ni dans un journal. Un agent local garde le coffre ouvert pour une durée limitée.",
        link: { label: "Lire la référence de kf", to: "/cli" },
      },
      {
        id: "mcp",
        title: "MCP pour agents IA",
        tags: ["Claude Code", "Sans valeur", "Génération"],
        description:
          "Un agent IA liste vos éléments et crée des secrets aléatoires. Aucun outil ne renvoie une valeur : rien de sensible n'entre dans la conversation du modèle.",
        link: { label: "Voir les outils MCP", to: "/mcp" },
      },
      {
        id: "crypto",
        title: "Chiffrement côté client",
        tags: ["age", "X25519", "scrypt"],
        description:
          "Le serveur ne stocke que des fichiers chiffrés. Un disque ou une image de machine volés ne révèlent rien sans votre mot de passe principal, qui ne quitte jamais votre poste.",
        link: { label: "Lire le modèle de sécurité", to: "/securite" },
      },
    ],
    securityTitle: "Ce que le serveur ne peut pas faire.",
    security: [
      {
        title: "Lire un secret",
        text: "Il ne reçoit que des fichiers chiffrés avec age. La clé reste dans votre navigateur ou votre agent local.",
      },
      {
        title: "Connaître votre mot de passe",
        text: "Le mot de passe principal déchiffre votre identité sur votre poste. Il n'est jamais envoyé.",
      },
      {
        title: "Garder une session",
        text: "Les sessions vivent en mémoire. Un redémarrage verrouille tout, et il faut déverrouiller de nouveau.",
      },
    ],
    definition:
      "Keyfold est un coffre de secrets auto-hébergé pour une seule personne : mots de passe, jetons d'API et phrases SSH chiffrés avec age, depuis le web, la CLI kf ou un agent IA.",
    faqTitle: "Questions fréquentes.",
    faq: [
      {
        question: "Keyfold est-il open source et auto-hébergé ?",
        answer:
          "Il est auto-hébergé : vous lancez vous-même le serveur Go (keyfold-server), qui garde des fichiers chiffrés dans un dossier de données local. Le code source est public sur GitHub (dev-toolings/Keyfold), mais le dépôt ne contient pas encore de fichier de licence. Il n'y a ni service en ligne ni compte à créer.",
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
          "Non. Le serveur ne stocke que des fichiers age et ne reçoit jamais le mot de passe principal, l'identité ni une valeur. Un disque volé ne révèle rien sans le mot de passe principal, d'où un minimum de 16 caractères pour un nouveau coffre. Un second facteur TOTP, en option, empêche en plus quiconque atteint le serveur de télécharger l'identité chiffrée.",
      },
      {
        question: "Un agent IA peut-il l'utiliser sans risque ?",
        answer:
          "Oui, dans des limites fixées par conception. kf mcp est un serveur MCP à trois outils (list_items, generate_item, vault_health) : aucun ne renvoie une valeur ou une note, aucun ne modifie ni ne supprime un élément. Pour donner un secret à un programme, kf run -env VAR=kf://nom/champ -- commande le place dans l'environnement de la commande, jamais dans ses arguments ni sur disque.",
      },
      {
        question: "Comment importer depuis Bitwarden ou 1Password ?",
        answer:
          "Avec la CLI : kf import -format bitwarden-json pour un export JSON de Bitwarden, -format 1password-1pux pour un export .1pux de 1Password, ou -format csv pour les CSV de Chrome, Firefox, Bitwarden et 1Password. Un élément déjà présent est ignoré, et les cartes de paiement sont ignorées puis listées. L'interface web ne propose pas encore l'import.",
      },
      {
        question: "Quelle différence avec 1Password ou Bitwarden ?",
        answer:
          "Le périmètre est plus petit : une seule personne, un coffre auto-hébergé, une interface web, une CLI et un serveur MCP. Le dépôt ne contient ni extension de navigateur, ni application mobile, ni partage entre utilisateurs. Il vise l'usage développeur : kf run, kf inject, des phrases de passe SSH pour les scripts et des outils MCP qui ne renvoient jamais une valeur.",
      },
      {
        question: "Qu'est-ce qui n'est pas encore fait ?",
        answer:
          "Le TLS : le serveur parle en HTTP simple et doit rester sur 127.0.0.1. Il n'y a ni unité de service, ni conteneur, ni configuration de proxy inverse, ni sauvegarde du dossier de données. Les exports laissent les pièces jointes de côté.",
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
          "The kf get command hands a passphrase to a script without ever writing it to a terminal or a log. A local agent keeps the vault open for a limited time.",
        link: { label: "Read the kf reference", to: "/en/cli" },
      },
      {
        id: "mcp",
        title: "MCP for AI agents",
        tags: ["Claude Code", "No values", "Generation"],
        description:
          "An AI agent lists your items and creates random secrets. No tool returns a value: nothing sensitive enters the model's conversation.",
        link: { label: "See the MCP tools", to: "/en/mcp" },
      },
      {
        id: "crypto",
        title: "Client-side encryption",
        tags: ["age", "X25519", "scrypt"],
        description:
          "The server only stores encrypted files. A stolen disk or machine image reveals nothing without your master password, which never leaves your computer.",
        link: { label: "Read the security model", to: "/en/security" },
      },
    ],
    securityTitle: "What the server cannot do.",
    security: [
      {
        title: "Read a secret",
        text: "It only receives files encrypted with age. The key stays in your browser or your local agent.",
      },
      {
        title: "Know your password",
        text: "The master password decrypts your identity on your computer. It is never sent.",
      },
      {
        title: "Keep a session",
        text: "Sessions live in memory. A restart locks everything, and you unlock again.",
      },
    ],
    definition:
      "Keyfold is a self-hosted secrets vault for one person: passwords, API tokens and SSH passphrases encrypted with age, from the web, the kf CLI or an AI agent.",
    faqTitle: "Frequently asked questions.",
    faq: [
      {
        question: "Is Keyfold open source and self-hosted?",
        answer:
          "It is self-hosted: you run the Go server (keyfold-server) yourself, and it keeps encrypted files in a local data directory. The source code is public on GitHub (dev-toolings/Keyfold), but the repository has no license file yet. There is no online service and no account to create.",
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
          "No. The server stores only age files and never receives the master password, the identity or a value. A stolen disk reveals nothing without the master password, which is why a new vault needs one of at least 16 characters. An optional TOTP second factor also stops anyone who reaches the server from downloading the encrypted identity.",
      },
      {
        question: "Can AI agents use it safely?",
        answer:
          "Yes, within limits set by design. kf mcp is an MCP server with three tools (list_items, generate_item, vault_health): none returns a value or a note, and none edits or deletes an item. To hand a secret to a program, kf run -env VAR=kf://name/field -- command puts it in that command's environment, never in its arguments or on disk.",
      },
      {
        question: "How do I import from Bitwarden or 1Password?",
        answer:
          "With the CLI: kf import -format bitwarden-json for a Bitwarden JSON export, -format 1password-1pux for a 1Password .1pux export, or -format csv for CSV files from Chrome, Firefox, Bitwarden and 1Password. An item already present is skipped, and payment cards are skipped and listed. The web UI does not offer import yet.",
      },
      {
        question: "How does it compare with 1Password or Bitwarden?",
        answer:
          "Its scope is smaller: one person, one self-hosted vault, a web UI, a CLI and an MCP server. The repository has no browser extension, no mobile app and no sharing between users. It targets developer use: kf run, kf inject, SSH passphrases for scripts and MCP tools that never return a value.",
      },
      {
        question: "What is not done yet?",
        answer:
          "TLS: the server speaks plain HTTP and must stay on 127.0.0.1. There is no service unit, container or reverse proxy setup, and no backup of the data directory. Exports leave attachments out.",
      },
    ],
    footer: "Self-hosted software, with no online service.",
    otherLang: { label: "Français", to: "/" },
  },
};
