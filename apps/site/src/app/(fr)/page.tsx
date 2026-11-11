import { FaqJsonLd } from "@/components/json-ld";
import { LandingPage } from "@/components/landing-page";

export default function Page() {
  return (
    <>
      <LandingPage lang="fr" />
      <FaqJsonLd lang="fr" />
    </>
  );
}
