#!/usr/bin/env python3
"""
AETHERIS // PROTOCOL — Agent baseline
─────────────────────────────────────
Un bot minimal qui joue à peu près le niveau d'un humain occasionnel.

Stratégie :
  1. Toujours upgrader le bâtiment économique le moins haut sur chaque planète.
  2. Investir 30 % du budget dans la recherche.
  3. Si attaqué (champ rapport reçu), envoyer la flotte en repli automatique.
  4. Pas de combat offensif (le bot ne déclare jamais la guerre).

Usage :
  python agents/baseline.py --player kael --apply
"""

import argparse
import os
import secrets
import sys

try:
    import yaml
except ImportError:
    print("requires: pip install pyyaml", file=sys.stderr)
    sys.exit(1)


def load(path):
    with open(path) as f:
        return yaml.safe_load(f)


def save(path, obj):
    with open(path, "w") as f:
        yaml.dump(obj, f, default_flow_style=False, sort_keys=False, allow_unicode=True)


PRIO_ECO = [
    "mine_ferrum",
    "extracteur_lumen",
    "synthetiseur_plasmide",
    "centrale_solaire",
    "depot",
    "usine_robotique",
    "laboratoire",
]


def decide_chantier(planete):
    """Retourne (batiment, niveau_cible) à upgrader, ou None."""
    if planete.get("file_chantier"):
        return None  # déjà occupé
    batiments = planete.get("batiments", {})
    # Upgrade le bâtiment de notre liste prioritaire avec le niveau le plus bas
    candidats = [(b, batiments.get(b, 0)) for b in PRIO_ECO]
    candidats.sort(key=lambda x: x[1])
    cible_b, cible_n = candidats[0]
    return {
        "type": "chantier",
        "planete": planete["nom"],
        "batiment": cible_b,
        "niveau_cible": cible_n + 1,
    }


def decide_recherche(empire):
    """Une recherche par tour si la file est libre."""
    if empire.get("file_recherche"):
        return None
    recherche = empire.get("recherche", {})
    # Cherche la techno la moins développée parmi celles utiles tôt
    prio = ["robotique", "automation_miniere", "fusion_controlee", "drives_impulsion", "armement"]
    candidats = [(t, recherche.get(t, 0)) for t in prio]
    candidats.sort(key=lambda x: x[1])
    cible_t, cible_n = candidats[0]
    return {
        "type": "recherche",
        "technologie": cible_t,
        "niveau_cible": cible_n + 1,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--player", required=True)
    ap.add_argument("--root", default=".")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    manifest = load(os.path.join(args.root, "world/manifest.yaml"))
    empire = load(os.path.join(args.root, f"joueurs/{args.player}/empire.yaml"))

    tick_suivant = manifest["tick"] + 1
    ordres = []

    # Une décision par planète
    for p in empire.get("planetes", []):
        decision = decide_chantier(p)
        if decision:
            ordres.append(decision)

    # Une recherche par tour
    rec = decide_recherche(empire)
    if rec:
        ordres.append(rec)

    payload = {
        "version": 1,
        "joueur": args.player,
        "tick_cible": tick_suivant,
        "nonce": secrets.token_hex(3),
        "ordres": ordres,
        "signature": "ed25519:STUB_BASELINE_AGENT_NOT_VERIFIED",
    }

    print(f"agent baseline pour {args.player} @ tick {tick_suivant}")
    print(f"  → {len(ordres)} ordre(s) :")
    for o in ordres:
        if o["type"] == "chantier":
            print(f"     · {o['planete']}: {o['batiment']} → niv {o['niveau_cible']}")
        elif o["type"] == "recherche":
            print(f"     · recherche {o['technologie']} → niv {o['niveau_cible']}")

    if args.apply:
        path = os.path.join(args.root, f"joueurs/{args.player}/ordres.yaml")
        save(path, payload)
        print(f"\n✓ écrit dans {path}")
        print(f"  prochaine étape : git add joueurs/{args.player} && git commit && git push")
    else:
        print("\n(--apply pour écrire le fichier)")


if __name__ == "__main__":
    main()
