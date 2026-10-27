import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { browserLocalPersistence, getAuth, setPersistence } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyCLbyUgGUcgBalU6pHTewkqtFgUyZrprrs',
  authDomain: 'quota-e1424.firebaseapp.com',
  projectId: 'quota-e1424',
  storageBucket: 'quota-e1424.firebasestorage.app',
  messagingSenderId: '304261658787',
  appId: '1:304261658787:web:eae19ec101a820daee6716',
};

const app = initializeApp(firebaseConfig);
const isIOSWebKit = typeof navigator !== 'undefined' && (
  /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
);
const db = initializeFirestore(app, isIOSWebKit
  ? {
      experimentalForceLongPolling: true,
      localCache: memoryLocalCache(),
    }
  : {
      experimentalAutoDetectLongPolling: true,
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
const auth = getAuth(app);
const authPersistenceReady = setPersistence(auth, browserLocalPersistence).catch(() => {});

// Una pestanya amb un Firebase més nou ha de convertir la base de dades local i no pot mentre
// una altra la tingui oberta: aquesta es recarrega per deixar-la fer.
const FIRESTORE_DB_NAME = `firestore/[DEFAULT]/${firebaseConfig.projectId}/main`;
const UPGRADE_RELOAD_KEY = 'guardies:firestore-upgrade-reload';

function reloadWhenAnotherTabUpgradesFirestore(attempt = 0) {
  if (typeof indexedDB === 'undefined' || attempt > 10) return;
  const request = indexedDB.open(FIRESTORE_DB_NAME);
  // Si encara no existeix, la crea Firestore, no aquí.
  request.onupgradeneeded = () => request.transaction.abort();
  request.onerror = () => window.setTimeout(() => reloadWhenAnotherTabUpgradesFirestore(attempt + 1), 5000);
  request.onsuccess = () => {
    const connection = request.result;
    connection.onversionchange = (event) => {
      connection.close();
      if (!event.newVersion) return;
      try {
        const last = Number(sessionStorage.getItem(UPGRADE_RELOAD_KEY)) || 0;
        if (Date.now() - last < 60_000) return;
        sessionStorage.setItem(UPGRADE_RELOAD_KEY, String(Date.now()));
      } catch {
        // Sense sessionStorage es recarrega igualment: només passa en canviar de versió.
      }
      window.setTimeout(() => window.location.reload(), 500);
    };
  };
}

// Després de la càrrega: així la conversió que fa aquesta mateixa pestanya no la recarrega.
if (!isIOSWebKit && typeof window !== 'undefined') {
  window.setTimeout(() => reloadWhenAnotherTabUpgradesFirestore(), 5000);
}

export { db, auth, isIOSWebKit, authPersistenceReady };
