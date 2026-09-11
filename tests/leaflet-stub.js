// Generic Proxy-based Leaflet stub for Playwright verification without
// network access. Provides real implementations for L.latLng/L.latLngBounds/
// L.point (since app code does real coordinate math on these), and a fully
// generic infinitely-chainable Proxy for everything else in L (methods,
// classes, controls, etc.) so no Leaflet API surface needs to be enumerated
// by hand.
(function(){
  function realLatLng(lat, lng){
    if(lat && typeof lat === 'object'){
      if(Array.isArray(lat)) return realLatLng(lat[0], lat[1]);
      if('lat' in lat) return realLatLng(lat.lat, lat.lng != null ? lat.lng : lat.lon);
    }
    return {
      lat: Number(lat), lng: Number(lng),
      equals(o){ return o && this.lat === o.lat && this.lng === o.lng; },
      toString(){ return `LatLng(${this.lat}, ${this.lng})`; },
      distanceTo(){ return 0; },
    };
  }
  function realLatLngBounds(sw, ne){
    if(Array.isArray(sw) && ne === undefined){
      // array of latlngs
      let minLat=Infinity,minLng=Infinity,maxLat=-Infinity,maxLng=-Infinity;
      sw.forEach(p=>{
        const ll = Array.isArray(p) ? realLatLng(p[0],p[1]) : realLatLng(p.lat, p.lng);
        minLat=Math.min(minLat,ll.lat); maxLat=Math.max(maxLat,ll.lat);
        minLng=Math.min(minLng,ll.lng); maxLng=Math.max(maxLng,ll.lng);
      });
      sw = realLatLng(minLat,minLng); ne = realLatLng(maxLat,maxLng);
    } else {
      sw = Array.isArray(sw) ? realLatLng(sw[0],sw[1]) : realLatLng(sw.lat, sw.lng);
      ne = Array.isArray(ne) ? realLatLng(ne[0],ne[1]) : realLatLng(ne.lat, ne.lng);
    }
    return {
      _sw: sw, _ne: ne,
      getSouthWest(){ return sw; },
      getNorthEast(){ return ne; },
      getNorth(){ return ne.lat; }, getSouth(){ return sw.lat; },
      getEast(){ return ne.lng; }, getWest(){ return sw.lng; },
      getCenter(){ return realLatLng((sw.lat+ne.lat)/2, (sw.lng+ne.lng)/2); },
      contains(p){
        const ll = p && p.lat != null ? p : realLatLng(p[0], p[1]);
        return ll.lat >= sw.lat && ll.lat <= ne.lat && ll.lng >= sw.lng && ll.lng <= ne.lng;
      },
      extend(){ return this; },
      isValid(){ return true; },
    };
  }
  function realPoint(x, y){ return {x:Number(x), y:Number(y)}; }

  function makeChainable(name){
    const fn = function(){ return chainProxy; };
    const target = fn;
    const chainProxy = new Proxy(target, {
      get(t, prop){
        if(prop === Symbol.toPrimitive) return () => '';
        if(prop === 'then') return undefined; // not a thenable
        if(prop === 'valueOf') return () => chainProxy;
        if(prop === 'toString') return () => '';
        if(typeof prop === 'symbol') return undefined;
        return makeChainable(name + '.' + String(prop));
      },
      apply(){ return chainProxy; },
      construct(){ return chainProxy; },
      set(){ return true; },
    });
    return chainProxy;
  }

  const L = new Proxy(function(){}, {
    get(t, prop){
      if(prop === 'latLng') return (...a) => a.length === 1 ? realLatLng(a[0]) : realLatLng(a[0], a[1]);
      if(prop === 'latLngBounds') return (...a) => a.length === 1 ? realLatLngBounds(a[0]) : realLatLngBounds(a[0], a[1]);
      if(prop === 'point') return (...a) => realPoint(a[0], a[1]);
      if(prop === 'Util') return { extend: Object.assign, stamp: (o) => (o.__stamp = o.__stamp || Math.random()) };
      if(prop === 'DomUtil') return makeChainable('DomUtil');
      if(prop === 'DomEvent') return makeChainable('DomEvent');
      if(typeof prop === 'symbol') return undefined;
      return makeChainable('L.' + String(prop));
    },
    apply(){ return makeChainable('L()'); },
    construct(){ return makeChainable('new L()'); },
  });
  window.L = L;
})();
