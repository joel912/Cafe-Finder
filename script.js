const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

function getLocationCachedOrNew() {
  const cache = JSON.parse(localStorage.getItem('cachedLocation') || '{}');
  const now = Date.now();
  // Cache location for 10 minutes
  if (cache.timestamp && now - cache.timestamp < 10 * 60 * 1000) {
    useLocation(cache.lat, cache.lng);
  } else {
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      localStorage.setItem('cachedLocation', JSON.stringify({ lat, lng, timestamp: now }));
      useLocation(lat, lng);
    }, () => alert("Location access denied or unavailable."));
  }
}

async function useLocation(lat, lng) {
  // Overpass QL Query: finds nodes tagged as 'amenity=cafe' within 1500m
  const query = `
    [out:json];
    node["amenity"="cafe"](around:1500, ${lat}, ${lng});
    out body;
  `;
  
  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      body: query
    });
    const data = await response.json();
    
    if (data.elements && data.elements.length > 0) {
      displayCards(data.elements);
    } else {
      alert("No cafes found in this area.");
    }
  } catch (e) {
    console.error("Error fetching Overpass API:", e);
    alert("Error fetching cafes.");
  }
}

function displayCards(cafes) {
  const container = document.querySelector('.cards');
  container.innerHTML = '';

  cafes.forEach((cafe, i) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'swipe-wrapper';
    wrapper.style.zIndex = 200 - i;

    const card = document.createElement('div');
    card.className = 'location-card';

    // Using Unsplash Source for free relevant imagery
    const imgUrl = `https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=400&q=80&sig=${cafe.id}`;
    
    const cafeData = {
      name: cafe.tags.name || "Unnamed Cafe",
      id: cafe.id,
      photo: imgUrl,
      cuisine: cafe.tags.cuisine || "Coffee & Tea"
    };

    card.innerHTML = `
      <img src="${imgUrl}" alt="${cafeData.name}" />
      <h3>${cafeData.name}</h3>
      <p>📍 ${cafeData.cuisine}</p>
      <p><small>Swipe right to save 💖</small></p>
    `;

    wrapper.appendChild(card);
    container.appendChild(wrapper);

    // Gestures
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
    console.log(`${cafe.name} saved!`);
  }
}

function showSaved() {
  const container = document.querySelector('.cards');
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
//updated project
