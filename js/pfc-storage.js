// pfc-storage.js — aislamiento de almacenamiento del Proyecto Final
// Evita leer o modificar claves de otras aplicaciones alojadas en el mismo origen.

(function () {
  'use strict';

  const PREFIX = 'pfc:';
  const nativeStorage = window.localStorage;

  function scopedKeys() {
    const out = [];
    for (let i = 0; i < nativeStorage.length; i++) {
      const k = nativeStorage.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
    return out;
  }

  const scopedStorage = new Proxy(nativeStorage, {
    get(target, prop) {
      if (prop === 'length') return scopedKeys().length;
      if (prop === 'key') return index => scopedKeys()[Number(index)] ?? null;
      if (prop === 'getItem') return key => target.getItem(PREFIX + String(key));
      if (prop === 'setItem') return (key, value) => target.setItem(PREFIX + String(key), String(value));
      if (prop === 'removeItem') return key => target.removeItem(PREFIX + String(key));
      if (prop === 'clear') return () => {
        const keys = scopedKeys();
        keys.forEach(key => target.removeItem(PREFIX + key));
      };

      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });

  try {
    Object.defineProperty(window, 'localStorage', {
      configurable: false,
      enumerable: true,
      get: () => scopedStorage
    });

    Object.defineProperty(window, '__PFC_STORAGE__', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({ prefix: PREFIX, ready: true })
    });

    console.info('[PFC] almacenamiento local aislado correctamente.');
  } catch (error) {
    console.error('[PFC] no se pudo aislar localStorage:', error);
    window.__PFC_STORAGE__ = { prefix: PREFIX, ready: false, error: String(error?.message || error) };
  }
})();
