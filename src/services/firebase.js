import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAWf_Zpn-J_i0kLIKJg0rwWpEdtrA_rhaM",
  authDomain: "ai-gency-82d6d.firebaseapp.com",
  projectId: "ai-gency-82d6d",
  storageBucket: "ai-gency-82d6d.firebasestorage.app",
  messagingSenderId: "276098673565",
  appId: "1:276098673565:web:19cf6c4541dd37cc5f1d74"
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { app, db };
