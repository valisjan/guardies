import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

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

export { db, auth, isIOSWebKit };
