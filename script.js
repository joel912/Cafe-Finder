// Use the HTTPS-compliant mirror to avoid "Mixed Content" errors
const OVERPASS_URL = "https://overpass.openstreetmap.fr/api/interpreter";

function getLocationCachedOrNew() {
  const status = document.getElementById('status-message');
  status.innerText = "Getting your location...";
  
  const cache = JSON.parse(localStorage.getItem('cachedLocation') || '{}');
  const now = Date.now();

  if (cache.timestamp && now - cache.timestamp < 10 * 60 * 1000) {
    useLocation(cache.lat, cache.lng);
  } else {
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      localStorage.setItem('cachedLocation', JSON.stringify({ lat, lng, timestamp: now }));
      useLocation(lat, lng);
    }, () => {
      status.innerText = "Location access denied.";
      alert("Please enable location services.");
    });
  }
}

async function useLocation(lat, lng) {
  const status = document.getElementById('status-message');
  const container = document.querySelector('.cards');
  status.innerText = "Searching for cafes nearby...";
  container.innerHTML = '';

  // Added [timeout:25] for better reliability
  const query = `
    [out:json][timeout:25];
    node["amenity"="cafe"](around:1500, ${lat}, ${lng});
    out body;
  `;
  
  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      body: query
    });
    
    if (!response.ok) throw new Error("Network response was not ok");
    
    const data = await response.json();
    status.innerText = ""; // Clear status

    if (data.elements && data.elements.length > 0) {
      displayCards(data.elements);
    } else {
      status.innerText = "No cafes found in this 1.5km radius.";
    }
  } catch (e) {
    console.error("Fetch error:", e);
    status.innerText = "Error fetching cafes. Please try again.";
  }
}

function displayCards(cafes) {
  const container = document.querySelector('.cards');
  cafes.forEach((cafe, i) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'swipe-wrapper';
    wrapper.style.zIndex = 200 - i;

    const imgUrl = `https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=400&q=80&sig=${cafe.id}`;
    
    const cafeData = {
      name: cafe.tags.name || "Unnamed Cafe",
      id: cafe.id,
      photo: imgUrl,
      cuisine: cafe.tags.cuisine || "Coffee & Tea"
    };

    wrapper.innerHTML = `
      <div class="location-card">
        <img src="${imgUrl}" alt="${cafeData.name}" />
        <h3>${cafeData.name}</h3>
        <p>📍 ${cafeData.cuisine}</p>
        <p><small>Swipe right to save 💖</small></p>
      </div>
    `;

    container.appendChild(wrapper);

    const hammertime = new Hammer(wrapper);
    hammertime.on('swipeleft', () => {
      wrapper.style.transform = 'translateX(-150%) rotate(-15deg)';
      wrapper.style.opacity = 0;
      setTimeout(() => wrapper.remove(), 200);
    });

    hammertime.on('swiperight', () => {
      saveCafe(cafeData);
      wrapper.style.transform = 'translateX(150%) rotate(15deg)';
      wrapper.style.opacity = 0;
      setTimeout(() => wrapper.remove(), 200);
    });
  });
}

function saveCafe(cafe) {
  let saved = JSON.parse(localStorage.getItem('savedCafes') || '[]');
  if (!saved.find(c => c.id === cafe.id)) {
    saved.push(cafe);
    localStorage.setItem('savedCafes', JSON.stringify(saved));
  }
}

function showSaved() {
  const container = document.querySelector('.cards');
  const status = document.getElementById('status-message');
  status.innerText = "";
  container.innerHTML = '<h2>Saved Favorites</h2>';
  const saved = JSON.parse(localStorage.getItem('savedCafes') || '[]');
  
  if (saved.length === 0) {
    container.innerHTML += '<p>No saved cafes yet 😢</p>';
    return;
  }

  saved.forEach(cafe => {
    const card = document.createElement('div');
    card.className = 'location-card saved';
    card.innerHTML = `
      <img src="${cafe.photo}" alt="${cafe.name}" />
      <h3>${cafe.name}</h3>
      <p>${cafe.cuisine}</p>
    `;
    container.appendChild(card);
  });
}