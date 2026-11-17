# Chrono Chouet'Bike

Appli web de chronométrage des jeunes à l'entraînement, utilisable à plusieurs encadrants avec leurs smartphones, y compris avec un réseau faible.

- **Hébergement de l'appli** : GitHub Pages (gratuit), à l'adresse `chrono.chouetbikeclub.fr`.
- **Comptes, données et synchronisation** : Supabase (plan gratuit, hébergé en Europe).
- **Aucune donnée dans GitHub** : le dépôt ne contient que le code. Les noms des jeunes et les temps sont dans Supabase, accessibles uniquement aux encadrants connectés.

Comptez 30 à 45 minutes pour l'installation. Tout se fait dans un navigateur, de préférence sur ordinateur.

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `index.html`, `app.js`, `styles.css` | L'appli |
| `config.js` | **À modifier** : adresse et clé publique Supabase |
| `sw.js`, `manifest.webmanifest`, icônes | Installation sur l'écran d'accueil et fonctionnement hors ligne |
| `supabase/schema.sql` | **À lancer une fois** dans Supabase : tables, droits, comptes |
| `.github/workflows/keepalive.yml` | Robot qui empêche la mise en pause de Supabase |

---

## Étape 1 : créer la base Supabase

1. Créez un compte sur https://supabase.com puis **New project**.
   - Nom : `chrono-chouetbike` (libre).
   - Région : choisissez une région **Europe** (par exemple Francfort).
   - Notez le mot de passe de base de données proposé, même si l'appli ne s'en sert pas.
2. Ouvrez `supabase/schema.sql` dans un éditeur de texte. **Tout en bas**, remplacez `votre.adresse@exemple.fr` par votre e-mail : ce sera le premier administrateur.
3. Dans Supabase : **SQL Editor > New query**, collez tout le fichier, cliquez **Run**. Le message attendu est « Success. No rows returned ».
4. Réglez les adresses de retour : **Authentication > URL Configuration**
   - Site URL : `https://chrono.chouetbikeclub.fr`
   - Redirect URLs : ajoutez `https://chrono.chouetbikeclub.fr/**`
5. Réglez la confirmation par e-mail : **Authentication > Sign In / Providers > Email**.
   Le service d'e-mail intégré de Supabase est prévu pour les tests : il est limité à 2 e-mails par heure et ne livre qu'aux adresses des membres de votre équipe Supabase. Deux possibilités :
   - **Simple (conseillé pour démarrer)** : désactivez **Confirm email**. Un encadrant crée son compte et entre directement. La protection vient de la liste des encadrants : une adresse absente de la liste ne peut pas créer de compte. Ajoutez donc un encadrant à la liste juste avant qu'il fasse sa première connexion, et vérifiez dans l'écran Admin qu'il est bien marqué « compte créé ».
   - **Plus strict** : laissez **Confirm email** activé et branchez votre propre envoi d'e-mails dans **Authentication > Emails > SMTP Settings** (une boîte mail de votre hébergeur convient). Cela active aussi « Mot de passe oublié ».

Les intitulés des menus Supabase peuvent varier légèrement d'une version à l'autre.

## Étape 2 : relier l'appli à la base

1. Dans Supabase : **Project Settings > API Keys**. Copiez la clé **Publishable** (elle commence par `sb_publishable_`). Si un bouton « Create new API keys » apparaît, cliquez dessus d'abord.
2. L'adresse du projet (`https://xxxx.supabase.co`) se trouve dans **Project Settings > Data API** ou via le bouton **Connect**.
3. Ouvrez `config.js` et remplacez les deux valeurs.

La clé « publishable » est conçue pour être visible dans une page web. Ne mettez jamais la clé « secret » dans ce dossier.

## Étape 3 : mettre l'appli sur GitHub Pages

1. Créez un compte sur https://github.com si besoin, puis **New repository**.
   - Nom : `chrono` (libre). Visibilité : **Public** (obligatoire pour GitHub Pages avec un compte gratuit).
2. Dans le dépôt : **Add file > Upload files**, glissez **tout le contenu** du dossier (y compris les dossiers `supabase` et `.github`, et le fichier `.nojekyll`), puis **Commit changes**.
   Sur Mac et Windows, les fichiers commençant par un point sont masqués : affichez les fichiers cachés avant de glisser. Si `.github` ne passe pas, créez le fichier à la main avec **Add file > Create new file**, nom `.github/workflows/keepalive.yml`, en copiant son contenu.
3. **Settings > Pages** : Source = **Deploy from a branch**, Branch = `main`, dossier `/ (root)`, **Save**.
4. Toujours dans **Settings > Pages**, champ **Custom domain** : saisissez `chrono.chouetbikeclub.fr`, **Save**. GitHub ajoute un fichier `CNAME` au dépôt, c'est normal.

## Étape 4 : créer le sous-domaine chez OVH

1. Espace client OVH > **Noms de domaine** > `chouetbikeclub.fr` > onglet **Zone DNS** > **Ajouter une entrée**.
2. Type **CNAME**, sous-domaine `chrono`, cible `VOTRE-COMPTE-GITHUB.github.io.` (avec le point final).
3. Attendez la propagation (de quelques minutes à quelques heures). Dans GitHub, **Settings > Pages** doit afficher « DNS check successful ». Cochez alors **Enforce HTTPS**.

Si vous changez de fournisseur de domaine plus tard, il suffira de recréer cette seule entrée CNAME chez le nouveau. Rien d'autre ne dépend d'OVH.

## Étape 5 : première connexion et listes

1. Ouvrez `https://chrono.chouetbikeclub.fr`, touchez **Première connexion**, saisissez l'e-mail déclaré à l'étape 1 et choisissez un mot de passe.
2. **Admin > Jeunes** : ajoutez les jeunes un par un ou importez un `.csv` (colonnes `nom ; groupe`, le groupe est facultatif). Exemple :
   ```
   nom;groupe
   Prénom Nom;Groupe 1
   Prénom Nom;Groupe 2
   ```
3. **Admin > Encadrants** : ajoutez chaque encadrant (ou `.csv` avec `nom ; e-mail ; rôle`, rôle = `admin` ou `encadrant`). Chacun fait ensuite **Première connexion** avec son adresse.
4. Sur chaque téléphone : ouvrez le site puis « Ajouter à l'écran d'accueil » (menu du navigateur sur Android, bouton Partager sur iPhone).

### Vérification rapide après installation

À faire une fois, avec deux téléphones côte à côte :

- [ ] Créer une session, y ajouter deux jeunes : elle apparaît sur le second téléphone.
- [ ] Poste « Départ » sur l'un, « Arrivée » sur l'autre : un départ fait tourner le chrono sur les deux.
- [ ] Mode avion sur le téléphone du départ, lancer un jeune, couper le mode avion : la pastille passe de « Hors ligne · 1 en attente » à « Synchronisé » et le chrono apparaît sur l'autre.
- [ ] Dans GitHub, onglet **Actions > Garder Supabase éveillé > Run workflow** : la coche doit être verte.

---

## Utilisation sur le terrain

- **Avant de partir** : ouvrez l'appli une fois avec du réseau (elle se met en cache et vous connecte), créez la session et choisissez les participants.
- **Poste** : chaque encadrant choisit son poste en haut de la session. Le bouton de chaque jeune en dépend.
  - *Départ* : bouton Départ. « Départ groupé » permet de cocher plusieurs jeunes et de les lancer au même instant.
  - *Inter* : bouton Inter pour les jeunes en course. Le rang au temps intermédiaire s'affiche sous le nom et la liste suit l'ordre sur le parcours.
  - *Arrivée* : bouton Stop.
  - *Dép./Arr.* (circuit) : Départ puis Stop. Stop fige l'instant ; on choisit ensuite Tour ou Fin, ligne par ligne, ce qui permet d'enchaîner plusieurs Stop quand les jeunes passent groupés.
- **Erreur de frappe** : le bandeau « Annuler » reste 7 secondes. Un passage se supprime aussi dans Résultats.
- **Réseau faible** : chaque appui est enregistré sur le téléphone avec son heure exacte, puis envoyé dès que possible. La pastille indique le nombre d'envois en attente ; la toucher force une synchronisation.
- **Départ pas encore reçu** : à l'Arrivée ou à l'Inter, un jeune non parti a un bouton en pointillés. Touchez-le à son passage : le temps est calculé quand le départ de l'autre encadrant arrive.
- **Résultats** : classement au meilleur temps, moyenne, moins bon temps, détail des inters et tours, export `.csv`.
- **Tracé GPX** : import après la séance. Si vous indiquez quel jeune portait l'appareil, distance et vitesses de chacun de ses passages sont calculées.
- **Archiver** : bouton en bas de l'onglet Chrono. Les sessions archivées se retrouvent en bas de l'accueil.

### Précision

Les horloges des téléphones sont alignées sur celle du serveur à chaque connexion, et l'heure retenue est celle où le doigt touche l'écran. La limite est donc le réflexe de l'encadrant, de l'ordre de un à deux dixièmes de seconde. C'est adapté à l'entraînement, pas à un classement officiel.

## À savoir

- **Pause du plan gratuit Supabase** : un projet gratuit est mis en pause après 7 jours sans activité, et peut être relancé depuis le tableau de bord pendant 90 jours. Le robot `keepalive.yml` interroge la base deux fois par semaine pour l'éviter. GitHub peut suspendre ce robot si le dépôt reste longtemps sans modification ; il prévient par e-mail et un clic le réactive.
- **Sauvegardes** : le plan gratuit n'en fournit pas. Exportez les résultats importants en `.csv`.
- **Mot de passe oublié** : fonctionne seulement si vous avez branché un envoi d'e-mails (étape 1, point 5). Sinon, supprimez l'utilisateur dans Supabase (**Authentication > Users**) et demandez à l'encadrant de refaire **Première connexion**.
- **Retirer un encadrant** : Admin > Encadrants > Retirer. Son accès aux données est coupé immédiatement.
- **Retirer un jeune** : il disparaît des listes de sélection, ses anciens temps restent lisibles.
- **Données personnelles** : la base contient des noms de mineurs. Gardez la région Europe, limitez la liste des encadrants aux personnes concernées et informez les familles selon les usages du club.
- **Mettre l'appli à jour** : remplacez les fichiers dans GitHub et augmentez le numéro dans `sw.js` (`chrono-v1` devient `chrono-v2`). Les téléphones prennent la nouvelle version à la deuxième ouverture.
- **Dépannage** : si l'écran indique que l'appli n'est pas reliée à sa base, `config.js` contient encore les valeurs d'exemple. Si « Première connexion » est refusée, l'adresse n'est pas dans la liste des encadrants (ou pas écrite à l'identique).
