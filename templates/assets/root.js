const modelElement = document.getElementById("model");
const cardsEl = document.getElementById("cards");
const packSearchEl = document.getElementById("searchPack");
const originSearchEl = document.getElementById("searchOrigin");
const resultHintEl = document.getElementById("resultHint");
const originsDatalist = document.getElementById("origins");

const model = JSON.parse(modelElement.textContent);

function currentRouteSlug() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return "";
  const last = parts[parts.length - 1];
  if (last.toLowerCase() === "index.html") return "";
  return last;
}

function redirectRouteToJson() {
  const slug = currentRouteSlug();
  if (!slug) return;

  if (slug === "all") {
    window.location.replace("./data/all.json");
    return;
  }

  const decodedSlug = decodeURIComponent(slug);
  const pack = model.packs.find((entry) => entry.encodedId === slug || entry.id === decodedSlug);

  if (pack) {
    window.location.replace("./data/" + pack.encodedId + ".json");
  }
}

redirectRouteToJson();

originsDatalist.innerHTML = model.origins
  .map((origin) => '<option value="' + origin.replaceAll('"', '&quot;') + '"></option>')
  .join("");

function faviconUrl(origin) {
  return "https://www.google.com/s2/favicons?sz=64&domain=" + encodeURIComponent(origin);
}

function createCard(pack) {
  const card = document.createElement("article");
  card.className = "card";

  const title = document.createElement("h2");
  const anchor = document.createElement("a");
  anchor.href = pack.route;
  anchor.textContent = pack.name || pack.id;
  title.appendChild(anchor);
  card.appendChild(title);

  const badges = document.createElement("div");
  badges.className = "badge-row";
  badges.innerHTML =
    '<span class="badge">ID: ' + pack.id + '</span>' +
    '<span class="badge">Targets: ' + pack.targetCount + '</span>' +
    '<span class="badge">Origins: ' + pack.origins.length + '</span>';
  card.appendChild(badges);

  const origins = document.createElement("div");
  origins.className = "origin-list";

  for (const origin of pack.origins.slice(0, 6)) {
    const chip = document.createElement("span");
    chip.className = "origin";
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.src = faviconUrl(origin);
    const text = document.createElement("span");
    text.textContent = origin;
    chip.appendChild(image);
    chip.appendChild(text);
    origins.appendChild(chip);
  }

  if (pack.origins.length > 6) {
    const more = document.createElement("span");
    more.className = "badge";
    more.textContent = "+" + (pack.origins.length - 6) + " more";
    origins.appendChild(more);
  }

  card.appendChild(origins);

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.innerHTML =
    '<a class="btn" href="' + pack.route + '">Open JSON</a>';
  card.appendChild(actions);

  return card;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function render() {
  const packTerm = normalize(packSearchEl.value);
  const originTerm = normalize(originSearchEl.value);

  const filtered = model.packs.filter((pack) => {
    const target = (pack.id + " " + (pack.name || "")).toLowerCase();
    const byPack = !packTerm || target.includes(packTerm);
    const byOrigin = !originTerm || pack.origins.some((origin) => origin.toLowerCase().includes(originTerm));
    return byPack && byOrigin;
  });

  cardsEl.innerHTML = "";

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No packs match the current filters.";
    cardsEl.appendChild(empty);
  } else {
    for (const pack of filtered) {
      cardsEl.appendChild(createCard(pack));
    }
  }

  resultHintEl.textContent =
    filtered.length +
    " / " +
    model.packs.length +
    " packs visible | " +
    model.origins.length +
    " total unique origins";
}

packSearchEl.addEventListener("input", render);
originSearchEl.addEventListener("input", render);
render();
