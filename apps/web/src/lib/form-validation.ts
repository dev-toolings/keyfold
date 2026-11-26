import { KINDS, type Kind, MIN_MASTER_PASSWORD_LENGTH } from "@keyfold/vault-core";
import { z } from "zod";

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{6}$/, "Saisissez le code à 6 chiffres.");

export const setupEmailSchema = z
  .string()
  .trim()
  .min(1, "Saisissez l'adresse email du propriétaire.")
  .pipe(z.email("Saisissez une adresse email valide."));

const masterPasswordSchema = z.string().min(1, "Saisissez le mot de passe principal.");

export const newMasterPasswordSchema = masterPasswordSchema.refine(
  (password) => !password || [...password].length >= MIN_MASTER_PASSWORD_LENGTH,
  `Le mot de passe doit faire au moins ${MIN_MASTER_PASSWORD_LENGTH} caractères.`,
);

export const createVaultSchema = z
  .object({
    password: newMasterPasswordSchema,
    confirm: z.string().min(1, "Confirmez le mot de passe principal."),
    installToken: z.string().trim(),
  })
  .refine(({ password, confirm }) => !password || !confirm || password === confirm, {
    path: ["confirm"],
    message: "Les mots de passe ne correspondent pas.",
  });

export const unlockVaultSchema = z.object({
  password: masterPasswordSchema,
  code: totpCodeSchema.optional(),
});

// These kinds can store their content in custom fields or in the SSH key.
export const OPTIONAL_VALUE_KINDS: Kind[] = ["identity", "ssh-key"];

const itemAddressSchema = z
  .string()
  .trim()
  .pipe(z.union([z.literal(""), z.url()], "Saisissez une adresse URL valide."));

export const itemFormSchema = z
  .object({
    name: z.string().trim().min(1, "Saisissez le nom de l'élément."),
    kind: z.enum(KINDS),
    value: z.string(),
    urls: z.array(itemAddressSchema),
  })
  .refine(({ kind, value }) => value !== "" || OPTIONAL_VALUE_KINDS.includes(kind), {
    path: ["value"],
    message: "Renseignez ce champ.",
  });
