// Funció programada de Netlify: de dilluns a divendres en horari escolar, cada minut revisa
// la cua de correus de Guàrdies i envia els que toquen des del compte del centre
// (vegeu netlify/lib/correus.mjs). Variables d'entorn (només per a funcions):
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

// Hora UTC. De 6 a 14 h cobreix de 8:00 a 15:00 tant a l'hivern (UTC+1) com a l'estiu
// (UTC+2): els correus programats per a les 8:00 i els del migdia hi caben sempre.
export const config = { schedule: '* 6-14 * * 1-5' };
