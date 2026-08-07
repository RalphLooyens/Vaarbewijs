# Vaarbewijs Backend — Opstarten & Deployment

## Lokaal testen (op je eigen computer)

### 1. Node.js installeren (eenmalig)
Download van https://nodejs.org — kies de LTS-versie.

### 2. Dependencies installeren
Open Terminal in de `backend` map:
```
npm install
```

### 3. .env aanmaken
```
cp .env.example .env
```
Open `.env` en vul een willekeurig lang JWT_SECRET in (bijv. 32+ letters/cijfers).

### 4. Quiz-bestand plaatsen
Kopieer `vaarbewijs_quiz.html` naar de `public` map en hernoem naar `quiz.html`:
```
cp ../vaarbewijs_quiz.html public/quiz.html
```

### 5. Server starten
```
npm run dev
```

De server draait nu op:
- Quiz:         http://localhost:3000/quiz
- Admin panel:  http://localhost:3000/admin

Het eerste admin-account wordt automatisch aangemaakt met de gegevens uit `.env`.

---

## Deployment op Railway (gratis starten)

### 1. Account aanmaken
Ga naar https://railway.app en maak een gratis account.

### 2. Nieuw project
- Klik "New Project" → "Deploy from GitHub repo"
- Push je `backend` map eerst naar een GitHub-repository

### 3. Environment variables instellen
In Railway → je project → Variables:
```
JWT_SECRET=een_lang_willekeurig_wachtwoord_hier
ADMIN_EMAIL=jouw@email.be
ADMIN_PASSWORD=JouwSterkWachtwoord123!
NODE_ENV=production
PORT=3000
```

### 4. Deploy
Railway detecteert automatisch Node.js en voert `npm start` uit.
Je krijgt een URL zoals `https://vaarbewijs-production.up.railway.app`.

### 5. Custom domein (optioneel)
In Railway → Settings → Domains → Add custom domain.

---

## Productie-checklist
- [ ] JWT_SECRET minimaal 32 tekens, willekeurig
- [ ] Admin wachtwoord gewijzigd na eerste login
- [ ] HTTPS actief (Railway doet dit automatisch)
- [ ] Quiz-bestand geplaatst in `public/quiz.html`
- [ ] Periodieke backup van `data/vaarbewijs.db`

---

## Backup database
```
cp data/vaarbewijs.db data/vaarbewijs_backup_$(date +%Y%m%d).db
```
