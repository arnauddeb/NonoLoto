# Nono Loto

Mini webapp statique, compatible mobile et GitHub Pages, pour analyser l'historique officiel FDJ du Loto et générer une grille statistique simple.

## Utilisation

Ouvre `index.html` via un petit serveur local :

```bash
python3 -m http.server 8010
```

Puis va sur `http://localhost:8010`.

## Source des données

Au lancement, l'app lit directement l'archive publique FDJ en ligne. Elle ne contient plus d'historique local : si la base FDJ en ligne est inaccessible, l'app demande de recharger quand la connexion revient.

`fflate.js` est embarqué localement pour lire le ZIP FDJ directement dans le navigateur.

## Important

Le Loto reste un jeu de hasard. L'application ne prédit pas l'avenir et ne garantit aucun gain. Elle propose seulement une grille issue de critères statistiques : fréquence récente, retard de sortie, paires observées et équilibre global.
