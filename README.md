# DoudouGPT

Application de chat web construite avec **React**, **OpenRouter** et **Supabase**.

Le projet combine une personnalité/prompt applicatif dédié, la génération de réponses via OpenRouter, la persistance des conversations et la gestion de contenus média/vision.

> **Sécurité :** une clé d'API privée ne doit jamais être embarquée dans un bundle React public. Si une clé OpenRouter a déjà été commitée, révoquez-la et remplacez l'appel direct par un backend/proxy qui conserve le secret côté serveur.

## Fonctionnalités

- interface de conversation React ;
- prompt/personnalité applicative centralisé ;
- appels de modèles via OpenRouter ;
- stratégie de modèle/fallback côté client ;
- persistance des conversations avec Supabase ;
- prise en charge de médias et d'entrées destinées à la vision ;
- analytics Vercel.

## Stack

- React 19
- Create React App / `react-scripts`
- Supabase JS
- OpenRouter
- Vercel Analytics

## Installation

```bash
git clone https://github.com/LeoPonchon/DoudouGPT.git
cd DoudouGPT
npm install
```

Créez votre configuration locale à partir des variables attendues par l'application, sans commiter de secrets.

Puis :

```bash
npm start
```

Pour produire un build :

```bash
npm run build
```

## Architecture

```text
src/
├── App.js
└── lib/
    ├── chatStore.js       # persistance/état des conversations
    ├── doudouPrompt.js    # prompt principal
    ├── mediaVision.js     # traitement média/vision
    ├── openrouter.js      # accès aux modèles
    └── supabaseClient.js  # client Supabase
```

## Gestion des secrets

Les variables React préfixées pour être exposées au navigateur sont publiques dans le build final. Utilisez-les uniquement pour des valeurs conçues pour être publiques (par exemple une clé Supabase publishable avec RLS correctement configuré).

Une clé OpenRouter privée doit rester côté serveur.
