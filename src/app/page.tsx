export default function Home() {
  return (
    <main>
      <h1>Campaign Preflight</h1>
      <p>Repérez les erreurs dans vos annonces Instagram Feed avant de transmettre votre kit à l&apos;agence.</p>
      <p>
        Ce service est un serveur MCP destiné à ChatGPT. Ajoutez l&apos;URL <code>/mcp</code> de ce domaine comme
        application personnalisée, puis demandez : « Ouvre Campaign Preflight pour vérifier mon kit Instagram Feed. »
      </p>
      <p>
        La seule page web de ce service est la <a href="/setup">page de configuration de la clé</a>, utilisée depuis le
        composant ChatGPT.
      </p>
    </main>
  );
}
