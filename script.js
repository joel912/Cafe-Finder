const GOOGLE_MAPS_API_KEY = "";
const SEARCH_RADIUS = 5000;
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const LOCATION_CACHE_KEY = "cachedLocation";
const SAVED_CAFES_KEY = "savedCafes";
const LOCATION_CACHE_TTL = 10 * 60 * 1000;
const GOOGLE_SCRIPT_ID = "google-maps-js";

let googleMapsLoaderPromise;
let currentSearchLocation = null;
let currentDeck = [];

function getCardsContainer() {
  return document.querySelector(".cards");
}

function getStatusElement() {
  return document.getElementById("status");
}

function getSavedCountElement() {
  return document.getElementById("saved-count");
}

function getRadiusSelect() {
  return document.getElementById("radius-select");
}

function setStatus(message, isError = false) {
  const status = getStatusElement();
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function updateSavedCount() {
  const saved = JSON.parse(localStorage.getItem(SAVED_CAFES_KEY) || "[]");
  const label = `${saved.length} saved`;
  getSavedCountElement().textContent = label;
}

function hasGooglePlacesKey() {
  return GOOGLE_MAPS_API_KEY.trim().length > 0;
}

function getSearchRadius() {
  return Number(getRadiusSelect()?.value || SEARCH_RADIUS);
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

      currentSearchLocation = { lat, lng };
      useLocation(lat, lng);
    },
    () => {
      setStatus("Location access was denied or unavailable.", true);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

async function useLocation(lat, lng) {
  currentSearchLocation = { lat, lng };

  if (hasGooglePlacesKey()) {
    await useGooglePlaces(lat, lng);
    return;
  }

  setStatus(
    "Using fallback data. Add a Google Maps API key in script.js for real cafe photos, full addresses, and ratings.",
    true
  );
  await useOpenStreetMap(lat, lng);
}

async function useGooglePlaces(lat, lng) {
  const container = getCardsContainer();
  container.classList.remove("saved-view");
  container.innerHTML = "";
  setStatus("Finding top cafes near you with Google Places...");
  const radius = getSearchRadius();

  try {
    await loadGoogleMapsApi();
    const { Place, SearchNearbyRankPreference } = await google.maps.importLibrary("places");

    const request = {
      fields: [
        "id",
        "displayName",
        "formattedAddress",
        "rating",
        "userRatingCount",
        "photos",
        "googleMapsURI"
      ],
      locationRestriction: {
        center: { lat, lng },
        radius
      },
      includedPrimaryTypes: ["cafe"],
      maxResultCount: 20,
      rankPreference: SearchNearbyRankPreference.POPULARITY
    };

    const { places } = await Place.searchNearby(request);
    const cafes = (places || []).map(normalizeGoogleCafe).filter(Boolean);

    if (cafes.length === 0) {
      currentDeck = [];
      setStatus("No cafes found in this area.");
      return;
    }

    currentDeck = cafes;
    setStatus(`Found ${cafes.length} cafes with Google Places. Swipe right to save your favorites.`);
    displayCards(cafes);
  } catch (error) {
    console.error("Error fetching Google Places data:", error);
    setStatus("Google Places failed, so showing fallback cafe data instead.", true);
    await useOpenStreetMap(lat, lng);
  }
}

function loadGoogleMapsApi() {
  if (window.google?.maps?.importLibrary) {
    return Promise.resolve();
  }

  if (!hasGooglePlacesKey()) {
    return Promise.reject(new Error("Missing Google Maps API key"));
  }

  if (googleMapsLoaderPromise) {
    return googleMapsLoaderPromise;
  }

  googleMapsLoaderPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(GOOGLE_SCRIPT_ID);

    if (existingScript) {
      existingScript.addEventListener("load", resolve, { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Failed to load Google Maps script")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.id = GOOGLE_SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&v=weekly&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps script"));
    document.head.appendChild(script);
  });

  return googleMapsLoaderPromise;
}

function normalizeGoogleCafe(place) {
  if (!place?.id) {
    return null;
  }

  const firstPhoto = place.photos?.[0];
  const firstAttribution = firstPhoto?.authorAttributions?.[0];

  return {
    place_id: place.id,
    name: place.displayName || "Cafe",
    address: place.formattedAddress || "Address not available",
    rating: typeof place.rating === "number" ? place.rating.toFixed(1) : "",
    ratingCount: typeof place.userRatingCount === "number" ? place.userRatingCount : 0,
    photo: firstPhoto ? firstPhoto.getURI({ maxHeight: 720, maxWidth: 1080 }) : "",
    photoAttribution: firstAttribution
      ? {
          displayName: firstAttribution.displayName,
          uri: firstAttribution.uri
        }
      : null,
    mapsUrl: place.googleMapsURI || ""
  };
}

async function useOpenStreetMap(lat, lng) {
  const radius = getSearchRadius();
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="cafe"](around:${radius},${lat},${lng});
      way["amenity"="cafe"](around:${radius},${lat},${lng});
      relation["amenity"="cafe"](around:${radius},${lat},${lng});
    );
    out center tags;
  `;

  const container = getCardsContainer();
  container.classList.remove("saved-view");
  container.innerHTML = "";
  setStatus("Finding cafes near you with limited fallback data...", true);

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
    const cafes = await enrichCafes(normalizeFallbackCafes(data.elements || []));

    if (cafes.length === 0) {
      currentDeck = [];
      setStatus("No cafes found in this area.");
      return;
    }

    currentDeck = cafes;
    setStatus(`Found ${cafes.length} cafes. Photos and ratings will improve once a Google Maps API key is added.`, true);
    displayCards(cafes);
  } catch (error) {
    console.error("Error fetching nearby cafes:", error);
    setStatus("Couldn't load cafes right now. Please try again in a moment.", true);
  }
}

function normalizeFallbackCafes(elements) {
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
        address: addressParts.join(", "),
        rating: "",
        ratingCount: 0,
        photo: getFallbackImageUrl(tags, tags.name),
        photoAttribution: null,
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${cafeLat},${cafeLng}`)}`,
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

function getFallbackImageUrl(tags, name) {
  if (tags.image) {
    return tags.image;
  }

  if (tags["image:0"]) {
    return tags["image:0"];
  }

  if (tags.wikimedia_commons) {
    const fileName = tags.wikimedia_commons.replace(/^File:/i, "");
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}`;
  }

  return `https://placehold.co/1080x720?text=${encodeURIComponent(name)}`;
}

async function enrichCafes(cafes) {
  const enriched = await Promise.all(
    cafes.map(async (cafe) => {
      if (cafe.address) {
        return cafe;
      }

      return {
        ...cafe,
        address: await fetchAddress(cafe.lat, cafe.lng)
      };
    })
  );

  return enriched;
}

async function fetchAddress(lat, lng) {
  try {
    const url = `${NOMINATIM_URL}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Reverse geocode failed with status ${response.status}`);
    }

    const data = await response.json();
    const address = data.address || {};
    const addressParts = [
      address.house_number,
      address.road,
      address.suburb || address.neighbourhood,
      address.city || address.town || address.village
    ].filter(Boolean);

    return addressParts.join(", ") || "Address not available";
  } catch (error) {
    console.error("Error fetching address:", error);
    return "Address not available";
  }
}

function renderRating(rating) {
  return rating ? `<p class="detail-line"><span>Rating</span><strong>${rating}</strong></p>` : "";
}

function renderRatingCount(ratingCount) {
  return ratingCount ? `<p class="detail-line"><span>Reviews</span><strong>${ratingCount}</strong></p>` : "";
}

function renderPhoto(photoUrl, cafeName) {
  const src = photoUrl || "https://placehold.co/1080x720?text=No+Image";
  return `<img src="${src}" alt="${cafeName}" onerror="this.src='https://placehold.co/1080x720?text=No+Image'" />`;
}

function renderPhotoAttribution(photoAttribution) {
  if (!photoAttribution?.displayName || !photoAttribution?.uri) {
    return "";
  }

  return `<p class="photo-credit">Photo by <a href="${photoAttribution.uri}" target="_blank" rel="noopener noreferrer">${photoAttribution.displayName}</a></p>`;
}

function renderMapsLink(mapsUrl) {
  if (!mapsUrl) {
    return "";
  }

  return `<a class="maps-link" href="${mapsUrl}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>`;
}

function displayCards(cafes) {
  const container = getCardsContainer();
  container.innerHTML = "";
  container.classList.remove("saved-view");

  cafes.forEach((cafe, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "swipe-wrapper";
    wrapper.style.zIndex = 200 - index;

    const card = document.createElement("article");
    card.className = "location-card";
    card.innerHTML = `
      <div class="image-wrap">
        ${renderPhoto(cafe.photo, cafe.name)}
      </div>
      <div class="card-body">
        <div class="card-topline">
          <p class="section-label">Cafe Pick</p>
          ${renderMapsLink(cafe.mapsUrl)}
        </div>
        <h3>${cafe.name}</h3>
        <p class="address">${cafe.address}</p>
        <div class="detail-grid">
          ${renderRating(cafe.rating)}
          ${renderRatingCount(cafe.ratingCount)}
        </div>
        ${renderPhotoAttribution(cafe.photoAttribution)}
        <p class="swipe-hint">Swipe right to save or left to move on.</p>
      </div>
    `;

    wrapper.appendChild(card);
    container.appendChild(wrapper);

    const hammer = new Hammer(wrapper);

    hammer.on("swipeleft", () => {
      dismissCard(wrapper, cafe, false);
    });

    hammer.on("swiperight", () => {
      dismissCard(wrapper, cafe, true);
    });
  });
}

function dismissCard(wrapper, cafe, shouldSave) {
  if (shouldSave) {
    saveCafe(cafe, { silent: true });
  }

  currentDeck = currentDeck.filter((item) => item.place_id !== cafe.place_id);
  wrapper.style.transform = shouldSave
    ? "translateX(150%) rotate(12deg)"
    : "translateX(-150%) rotate(-12deg)";
  wrapper.style.opacity = "0";
  setTimeout(() => {
    wrapper.remove();
    handleDeckCompletion();
  }, 180);
}

function getTopCardWrapper() {
  return getCardsContainer().querySelector(".swipe-wrapper");
}

function skipTopCard() {
  const wrapper = getTopCardWrapper();
  if (!wrapper) {
    setStatus("No more cafes in the current deck. Refresh to load more.");
    return;
  }

  const card = currentDeck[0];
  if (!card) {
    setStatus("No more cafes in the current deck. Refresh to load more.");
    return;
  }

  dismissCard(wrapper, card, false);
}

function saveTopCard() {
  const wrapper = getTopCardWrapper();
  if (!wrapper) {
    setStatus("No more cafes in the current deck. Refresh to load more.");
    return;
  }

  const card = currentDeck[0];
  if (!card) {
    setStatus("No more cafes in the current deck. Refresh to load more.");
    return;
  }

  dismissCard(wrapper, card, true);
}

function handleDeckCompletion() {
  if (currentDeck.length > 0) {
    return;
  }

  const container = getCardsContainer();
  if (!container.classList.contains("saved-view") && !container.querySelector(".empty-state")) {
    container.innerHTML = '<p class="empty-state">You reached the end of this deck. Refresh results or change the radius to explore more cafes.</p>';
    setStatus("Deck complete. Refresh results or adjust the radius for more cafes.");
  }
}

function saveCafe(cafe, options = {}) {
  const { silent = false } = options;
  const saved = JSON.parse(localStorage.getItem(SAVED_CAFES_KEY) || "[]");

  if (saved.find((item) => item.place_id === cafe.place_id)) {
    if (!silent) {
      setStatus(`${cafe.name} is already saved.`);
    }
    return;
  }

  saved.push(cafe);
  localStorage.setItem(SAVED_CAFES_KEY, JSON.stringify(saved));
  updateSavedCount();
  setStatus(`${cafe.name} saved to your list.`);
}

function showSaved() {
  const container = getCardsContainer();
  const saved = JSON.parse(localStorage.getItem(SAVED_CAFES_KEY) || "[]");

  container.classList.add("saved-view");
  container.innerHTML = "";

  if (saved.length === 0) {
    container.innerHTML = '<p class="empty-state">No saved cafes yet. Start swiping to build your shortlist.</p>';
    setStatus("You haven't saved any cafes yet.");
    return;
  }

  setStatus(`Showing ${saved.length} saved cafes.`);

  saved.forEach((cafe) => {
    const card = document.createElement("article");
    card.className = "location-card saved-card";
    card.innerHTML = `
      <div class="image-wrap">
        ${renderPhoto(cafe.photo, cafe.name)}
      </div>
      <div class="card-body">
        <div class="card-topline">
          <p class="section-label">Saved Cafe</p>
          ${renderMapsLink(cafe.mapsUrl)}
        </div>
        <h3>${cafe.name}</h3>
        <p class="address">${cafe.address}</p>
        <div class="detail-grid">
          ${renderRating(cafe.rating)}
          ${renderRatingCount(cafe.ratingCount)}
        </div>
        ${renderPhotoAttribution(cafe.photoAttribution)}
        <div class="saved-actions">
          <button class="ghost-button small-button" onclick="removeSavedCafe('${cafe.place_id}')">Remove</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function removeSavedCafe(placeId) {
  const saved = JSON.parse(localStorage.getItem(SAVED_CAFES_KEY) || "[]");
  const nextSaved = saved.filter((cafe) => cafe.place_id !== placeId);

  localStorage.setItem(SAVED_CAFES_KEY, JSON.stringify(nextSaved));
  updateSavedCount();
  setStatus("Cafe removed from your saved list.");
  showSaved();
}

function clearSavedCafes() {
  localStorage.setItem(SAVED_CAFES_KEY, JSON.stringify([]));
  updateSavedCount();
  setStatus("Saved cafes cleared.");

  const container = getCardsContainer();
  if (container.classList.contains("saved-view")) {
    showSaved();
  }
}

function refreshCurrentSearch() {
  if (currentSearchLocation) {
    useLocation(currentSearchLocation.lat, currentSearchLocation.lng);
    return;
  }

  getLocationCachedOrNew();
}

updateSavedCount();
