import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AiPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Intégration MCP</h2>
        </CardTitle>
        <CardDescription>
          L'outil MCP <code>vault_health</code> de <code>kf mcp</code> renvoie l'état du serveur et les indicateurs du
          coffre affichés dans « État du système ». Pour chaque élément signalé, il renvoie uniquement son nom.
          Remplacez <code>/chemin/vers/kf</code> par le chemin absolu du binaire sur la machine qui exécute Claude Code.
          Déverrouillez le coffre avec <code>"/chemin/vers/kf" unlock</code> avant d'utiliser les outils MCP.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
          <code>{'claude mcp add --transport stdio keyfold -- "/chemin/vers/kf" mcp'}</code>
        </pre>
      </CardContent>
    </Card>
  );
}
