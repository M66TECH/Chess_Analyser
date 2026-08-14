async function getFreeModels() {
  const response = await fetch('https://openrouter.ai/api/v1/models');
  const json = await response.json();
  const freeModels = json.data
    .filter(m => m.id.endsWith(':free') || m.pricing?.prompt === "0")
    .map(m => m.id);
  console.log("Free models:", freeModels);
}
getFreeModels();
