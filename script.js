const SEARCH_RADIUS = 5000;
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const LOCATION_CACHE_KEY = "cachedLocation";
const SAVED_CAFES_KEY = "savedCafes";
const LOCATION_CACHE_TTL = 10 * 60 * 1000;

function getCardsContainer() {
  return document.querySelector(".cards");
}

function getStatusElement() {
  return document.getElementById("status");
}

function setStatus(message, isError = false) {
  const status = getStatusElement();
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function getLocationCachedOrNew() {
  const cache = JSON.parse(localStorage.getItem(LOCATION_CACHE_KEY) || "{}");
  const now = Date.now();

  setStatus("Checking your location...");

  if (cache.timestamp && now - cache.timestamp < LOCATION_CACHE_TTL) {
    useLocation(cache.lat, cache.lng);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      localStorage.setItem(
        LOCATION_CACHE_KEY,
        JSON.stringify({ lat, lng, timestamp: now })
      );

      useLocation(lat, lng);
    },
    () => {
      setStatus("Location access was denied or unavailable.", true);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

async function useLocation(lat, lng) {
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="cafe"](around:${SEARCH_RADIUS},${lat},${lng});
      way["amenity"="cafe"](around:${SEARCH_RADIUS},${lat},${lng});
      relation["amenity"="cafe"](around:${SEARCH_RADIUS},${lat},${lng});
    );
    out center tags;
  `;

  const container = getCardsContainer();
  container.classList.remove("saved-view");
  container.innerHTML = "";
  setStatus("Finding cafes near you...");

  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8"
      },
      body: query
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();
    const cafes = normalizeCafes(data.elements || []);

    if (cafes.length === 0) {
      setStatus("No cafes found in this area.");
      return;
    }

    setStatus(`Found ${cafes.length} cafes. Swipe right to save your favorites.`);
    displayCards(cafes);
  } catch (error) {
    console.error("Error fetching nearby cafes:", error);
    setStatus("Couldn't load cafes right now. Please try again in a moment.", true);
  }
}

function normalizeCafes(elements) {
  const mapped = elements
    .map((element) => {
      const tags = element.tags || {};
      const cafeLat = element.lat ?? element.center?.lat;
      const cafeLng = element.lon ?? element.center?.lon;

      if (!tags.name || cafeLat == null || cafeLng == null) {
        return null;
      }

      const addressParts = [
        tags["addr:housenumber"],
        tags["addr:street"],
        tags["addr:city"] || tags["addr:suburb"]
      ].filter(Boolean);

      return {
        place_id: `${element.type}-${element.id}`,
        name: tags.name,
        address: addressParts.join(", ") || "Address not available",
        rating: tags.stars || "N/A",
        photo: `https://placehold.co/400x220?text=${encodeURIComponent(tags.name)}`,
        lat: cafeLat,
        lng: cafeLng
      };
    })
    .filter(Boolean);

  const unique = [];
  const seen = new Set();

  mapped.forEach((cafe) => {
    const key = `${cafe.name}-${cafe.address}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(cafe);
    }
  });

  return unique.slice(0, 20);
}

function displayCards(cafes) {
  const container = getCardsContainer();
  container.innerHTML = "";

  cafes.forEach((cafe, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "swipe-wrapper";
    wrapper.style.zIndex = 200 - index;

    const card = document.createElement("div");
    card.className = "location-card";
    card.innerHTML = `
      <img src="${cafe.photo}" alt="${cafe.name}" />
      <h3>${cafe.name}</h3>
      <p>${cafe.address}</p>
      <p>Rating: ${cafe.rating}</p>
      <p><small>Swipe right to save</small></p>
    `;

    wrapper.appendChild(card);
    container.appendChild(wrapper);

    const hammer = new Hammer(wrapper);

    hammer.on("swipeleft", () => {
      wrapper.style.transform = "translateX(-150%) rotate(-15deg)";
      wrapper.style.opacity = "0";
      setTimeout(() => wrapper.remove(), 150);
    });

    hammer.on("swiperight", () => {
      saveCafe(cafe);
      wrapper.style.transform = "translateX(150%) rotate(15deg)";
      wrapper.style.opacity = "0";
      setTimeout(() => wrapper.remove(), 150);
    });
  });
}

function saveCafe(cafe) {
  const saved = JSON.parse(localStorage.getItem(SAVED_CAFES_KEY) || "[]");

  if (saved.find((item) => item.place_id === cafe.place_id)) {
    setStatus(`${cafe.name} is already saved.`);
    return;
  }

  saved.push(cafe);
  localStorage.setItem(SAVED_CAFES_KEY, JSON.stringify(saved));
  setStatus(`${cafe.name} saved to your list.`);
}

function showSaved() {
  const container = getCardsContainer();
  const saved = JSON.parse(localStorage.getItem(SAVED_CAFES_KEY) || "[]");

  container.classList.add("saved-view");
  container.innerHTML = "";

  if (saved.length === 0) {
    container.innerHTML = '<p class="empty-state">No saved cafes yet.</p>';
    setStatus("You haven't saved any cafes yet.");
    return;
  }

  setStatus(`Showing ${saved.length} saved cafes.`);

  saved.forEach((cafe) => {
    const card = document.createElement("div");
    card.className = "location-card";
    card.innerHTML = `
      <img src="${cafe.photo}" alt="${cafe.name}" />
      <h3>${cafe.name}</h3>
      <p>${cafe.address}</p>
      <p>Rating: ${cafe.rating}</p>
    `;
    container.appendChild(card);
  });
}
