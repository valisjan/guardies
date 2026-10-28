// Funció programada de Netlify: cada minut revisa la cua de correus de Guàrdies i envia
// els que toquen des del compte del centre (vegeu netlify/lib/correus.mjs). Quan toca
// cada avís ho decideix la seva hora de sortida; les proves surten sempre al moment.
// Variables d'entorn (només per a funcions):
//   CORREU_COMPTE, CORREU_CONTRASENYA          compte que envia i contrasenya d'aplicació
//   GUARDIES_FIRESTORE_COMPTE, GUARDIES_FIRESTORE_CLAU   compte de servei amb accés a Firestore
import nodemailer from 'nodemailer';
import { processMailQueue } from '../lib/correus.mjs';
import { firestoreRest, serviceAccountToken } from '../lib/firestore-rest.mjs';

export default async () => {
  const account = process.env.CORREU_COMPTE || '';
  const password = process.env.CORREU_CONTRASENYA || '';
  const clientEmail = process.env.GUARDIES_FIRESTORE_COMPTE || '';
  const privateKey = (process.env.GUARDIES_FIRESTORE_CLAU || '').replace(/\\n/g, '\n');
  if (!account || !password || !clientEmail || !privateKey) {
    console.error('Servei de correu de Guàrdies: falten variables d\'entorn.');
    return;
  }
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: account, pass: password },
  });
  const summary = await processMailQueue({
    firestore: firestoreRest({ token: serviceAccountToken({ clientEmail, privateKey }) }),
    account,
    now: new Date(),
    log: (text) => console.log(text),
    send: ({ to, subject, text, senderName, replyTo }) => transport.sendMail({
      from: { name: senderName || 'Guàrdies', address: account },
      to,
      subject,
      text,
      ...(replyTo ? { replyTo } : {}),
    }),
  });
  if (summary.pendents) console.log(JSON.stringify(summary));
};

// Cada minut, tots els dies: unes 43.000 execucions al mes (el pla gratuït en permet 125.000).
export const config = { schedule: '* * * * *' };
