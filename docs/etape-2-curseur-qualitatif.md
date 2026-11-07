# Étape 2 · C4 — contrôle qualitatif du curseur

> Annexe de `docs/etape-2-modele.md` (section 5, C4). Généré le 7 novembre 2026 depuis `pipeline/data/processed/results/slider/qualitative_test.json` (`uv run python sweep_slider.py qualitative`).

**Choix des utilisateurs** (jeu de **test**, affichage uniquement, aucune métrique) : utilisateurs de test ayant 40 à 400 films en fold-in ; pour chacun, la popularité médiane (notes d'entraînement) des films de son fold-in ; on prend l'utilisateur le plus proche du 10e, du 50e et du 90e centile de cette valeur. **Les mêmes 3 utilisateurs pour A et B.**

Chaque film : titre TMDB, année, nombre total de notes MovieLens. λ = 0 (ordre du modèle), 1,0 (milieu) et 2,0 (maximum du balayage). En gras : films absents de la liste à λ = 0 du même modèle et de la même source.


## Profil 1 — le plus « pointu » (10e centile)

`userId` 28392 · 141 films en fold-in · popularité médiane du fold-in : 7 466 notes · note moyenne 3,45

Ses films les mieux notés (fold-in) : The Big Lebowski (1998, 36 349) ; Glengarry Glen Ross (1992, 7 205) ; Tinker Tailor Soldier Spy (2011, 3 379) ; Withnail & I (1987, 2 077) ; The Ipcress File (1965, 865) ; Performance. (1970, 223) ; The Grifters (1990, 6 821) ; Wild at Heart (1990, 2 533)


**Source de popularité : `ml_rating_count`**

| # | A · λ = 0,0 | A · λ = 1,0 | A · λ = 2,0 | B · λ = 0,0 | B · λ = 1,0 | B · λ = 2,0 |
|---|---|---|---|---|---|---|
| 1 | Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb (1964, 32 830) | Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb (1964, 32 830) | Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb (1964, 32 830) | The Great Escape (1963, 13 217) | The Great Escape (1963, 13 217) | The Great Escape (1963, 13 217) |
| 2 | The Good, the Bad and the Ugly (1966, 22 922) | The Good, the Bad and the Ugly (1966, 22 922) | The Good, the Bad and the Ugly (1966, 22 922) | Harold and Maude (1971, 9 462) | Harold and Maude (1971, 9 462) | Harold and Maude (1971, 9 462) |
| 3 | Life of Brian (1979, 27 292) | Life of Brian (1979, 27 292) | Life of Brian (1979, 27 292) | The Good, the Bad and the Ugly (1966, 22 922) | Deliverance (1972, 9 488) | Deliverance (1972, 9 488) |
| 4 | Fargo (1996, 58 031) | One Flew Over the Cuckoo's Nest (1975, 44 592) | One Flew Over the Cuckoo's Nest (1975, 44 592) | Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb (1964, 32 830) | The Good, the Bad and the Ugly (1966, 22 922) | **All the President's Men (1976, 6 274)** |
| 5 | One Flew Over the Cuckoo's Nest (1975, 44 592) | Fargo (1996, 58 031) | Fargo (1996, 58 031) | Life of Brian (1979, 27 292) | **All the President's Men (1976, 6 274)** | **The Conversation (1974, 5 693)** |
| 6 | Raiders of the Lost Ark (1981, 67 408) | Raiders of the Lost Ark (1981, 67 408) | Lock, Stock and Two Smoking Barrels (1998, 24 152) | Deliverance (1972, 9 488) | American Graffiti (1973, 8 424) | American Graffiti (1973, 8 424) |
| 7 | Fight Club (1999, 77 332) | Lock, Stock and Two Smoking Barrels (1998, 24 152) | Raiders of the Lost Ark (1981, 67 408) | Lock, Stock and Two Smoking Barrels (1998, 24 152) | **The Conversation (1974, 5 693)** | **Three Days of the Condor (1975, 4 117)** |
| 8 | Return of the Jedi (1983, 67 496) | Fight Club (1999, 77 332) | **Raging Bull (1980, 13 049)** | American Graffiti (1973, 8 424) | Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb (1964, 32 830) | **A Fistful of Dollars (1964, 9 062)** |
| 9 | Lock, Stock and Two Smoking Barrels (1998, 24 152) | The Princess Bride (1987, 46 957) | The Princess Bride (1987, 46 957) | North by Northwest (1959, 20 093) | Life of Brian (1979, 27 292) | **Easy Rider (1969, 6 411)** |
| 10 | The Princess Bride (1987, 46 957) | Return of the Jedi (1983, 67 496) | Fight Club (1999, 77 332) | The Deer Hunter (1978, 13 621) | **A Fistful of Dollars (1964, 9 062)** | The Good, the Bad and the Ugly (1966, 22 922) |

**Source de popularité : `tmdb_vote_count`**

| # | A · λ = 0,0 | A · λ = 1,0 | A · λ = 2,0 | B · λ = 0,0 | B · λ = 1,0 | B · λ = 2,0 |
|---|---|---|---|---|---|---|
| 1 | Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb (1964, 32 830) | Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb (1964, 32 830) | Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb (1964, 32 830) | The Great Escape (1963, 13 217) | **Wallace & Gromit: The Best of Aardman Animation (1996, 8 612)** | **Wallace & Gromit: The Best of Aardman Animation (1996, 8 612)** |
| 2 | The Good, the Bad and the Ugly (1966, 22 922) | The Good, the Bad and the Ugly (1966, 22 922) | The Good, the Bad and the Ugly (1966, 22 922) | Harold and Maude (1971, 9 462) | The Great Escape (1963, 13 217) | Harold and Maude (1971, 9 462) |
| 3 | Life of Brian (1979, 27 292) | Life of Brian (1979, 27 292) | Life of Brian (1979, 27 292) | The Good, the Bad and the Ugly (1966, 22 922) | Harold and Maude (1971, 9 462) | **Raiders of the Lost Ark: The Adaptation (2003, 1 312)** |
| 4 | Fargo (1996, 58 031) | Fargo (1996, 58 031) | Fargo (1996, 58 031) | Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb (1964, 32 830) | Deliverance (1972, 9 488) | **Sallie Gardner at a Gallop (1878, 36)** |
| 5 | One Flew Over the Cuckoo's Nest (1975, 44 592) | One Flew Over the Cuckoo's Nest (1975, 44 592) | One Flew Over the Cuckoo's Nest (1975, 44 592) | Life of Brian (1979, 27 292) | American Graffiti (1973, 8 424) | **Voldemort: Origins of the Heir (2018, 35)** |
| 6 | Raiders of the Lost Ark (1981, 67 408) | Raiders of the Lost Ark (1981, 67 408) | The Princess Bride (1987, 46 957) | Deliverance (1972, 9 488) | **And Now for Something Completely Different (1971, 6 773)** | **Power/Rangers (2015, 101)** |
| 7 | Fight Club (1999, 77 332) | The Princess Bride (1987, 46 957) | Raiders of the Lost Ark (1981, 67 408) | Lock, Stock and Two Smoking Barrels (1998, 24 152) | Life of Brian (1979, 27 292) | The Great Escape (1963, 13 217) |
| 8 | Return of the Jedi (1983, 67 496) | Lock, Stock and Two Smoking Barrels (1998, 24 152) | Lock, Stock and Two Smoking Barrels (1998, 24 152) | American Graffiti (1973, 8 424) | Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb (1964, 32 830) | **And Now for Something Completely Different (1971, 6 773)** |
| 9 | Lock, Stock and Two Smoking Barrels (1998, 24 152) | Fight Club (1999, 77 332) | **Butch Cassidy and the Sundance Kid (1969, 17 587)** | North by Northwest (1959, 20 093) | **A Grand Day Out (1990, 8 854)** | **Hearts & Minds (1995, 181)** |
| 10 | The Princess Bride (1987, 46 957) | Return of the Jedi (1983, 67 496) | **Raging Bull (1980, 13 049)** | The Deer Hunter (1978, 13 621) | **All the President's Men (1976, 6 274)** | Deliverance (1972, 9 488) |

## Profil 2 — médian (50e centile)

`userId` 94888 · 127 films en fold-in · popularité médiane du fold-in : 15 107 notes · note moyenne 3,42

Ses films les mieux notés (fold-in) : Indiana Jones and the Temple of Doom (1984, 29 294) ; Star Wars: Episode I - The Phantom Menace (1999, 37 973) ; The Hunt for Red October (1990, 26 219) ; Indiana Jones and the Last Crusade (1989, 46 401) ; Terminator 2: Judgment Day (1991, 68 383) ; Star Wars (1977, 85 010) ; Raiders of the Lost Ark (1981, 67 408) ; Three Kings (1999, 13 609)


**Source de popularité : `ml_rating_count`**

| # | A · λ = 0,0 | A · λ = 1,0 | A · λ = 2,0 | B · λ = 0,0 | B · λ = 1,0 | B · λ = 2,0 |
|---|---|---|---|---|---|---|
| 1 | Mission: Impossible (1996, 42 879) | Mission: Impossible (1996, 42 879) | Mission: Impossible (1996, 42 879) | The Last of the Mohicans (1992, 13 630) | The Last of the Mohicans (1992, 13 630) | The Last of the Mohicans (1992, 13 630) |
| 2 | Lethal Weapon 2 (1989, 15 124) | Lethal Weapon 2 (1989, 15 124) | Lethal Weapon 2 (1989, 15 124) | Tomorrow Never Dies (1997, 14 288) | Tomorrow Never Dies (1997, 14 288) | Tomorrow Never Dies (1997, 14 288) |
| 3 | Starship Troopers (1997, 21 043) | Tomorrow Never Dies (1997, 14 288) | Tomorrow Never Dies (1997, 14 288) | Seven Samurai (1954, 16 531) | Seven Samurai (1954, 16 531) | Conan the Barbarian (1982, 8 273) |
| 4 | Batman (1989, 49 789) | Starship Troopers (1997, 21 043) | Starship Troopers (1997, 21 043) | The Godfather Part III (1990, 12 326) | Conan the Barbarian (1982, 8 273) | Seven Samurai (1954, 16 531) |
| 5 | Tomorrow Never Dies (1997, 14 288) | The Last of the Mohicans (1992, 13 630) | The Last of the Mohicans (1992, 13 630) | Lethal Weapon 2 (1989, 15 124) | The Godfather Part III (1990, 12 326) | Ben-Hur (1959, 10 165) |
| 6 | The Last of the Mohicans (1992, 13 630) | Batman (1989, 49 789) | Batman (1989, 49 789) | The Godfather Part II (1974, 43 111) | Ben-Hur (1959, 10 165) | **Under Siege (1992, 7 098)** |
| 7 | The Untouchables (1987, 18 929) | The Untouchables (1987, 18 929) | The Untouchables (1987, 18 929) | Conan the Barbarian (1982, 8 273) | Lethal Weapon 2 (1989, 15 124) | The Godfather Part III (1990, 12 326) |
| 8 | In the Line of Fire (1993, 20 399) | In the Line of Fire (1993, 20 399) | Star Trek VI: The Undiscovered Country (1991, 11 736) | Cliffhanger (1993, 25 769) | **Star Trek VI: The Undiscovered Country (1991, 11 736)** | **Star Trek VI: The Undiscovered Country (1991, 11 736)** |
| 9 | The Godfather Part II (1974, 43 111) | Star Trek VI: The Undiscovered Country (1991, 11 736) | In the Line of Fire (1993, 20 399) | Ben-Hur (1959, 10 165) | **Under Siege (1992, 7 098)** | Lethal Weapon 2 (1989, 15 124) |
| 10 | Star Trek VI: The Undiscovered Country (1991, 11 736) | **The Mask of Zorro (1998, 16 068)** | **The Mask of Zorro (1998, 16 068)** | Starship Troopers (1997, 21 043) | **Star Trek: The Motion Picture (1979, 10 727)** | **Star Trek: The Motion Picture (1979, 10 727)** |

**Source de popularité : `tmdb_vote_count`**

| # | A · λ = 0,0 | A · λ = 1,0 | A · λ = 2,0 | B · λ = 0,0 | B · λ = 1,0 | B · λ = 2,0 |
|---|---|---|---|---|---|---|
| 1 | Mission: Impossible (1996, 42 879) | Mission: Impossible (1996, 42 879) | Mission: Impossible (1996, 42 879) | The Last of the Mohicans (1992, 13 630) | The Last of the Mohicans (1992, 13 630) | The Last of the Mohicans (1992, 13 630) |
| 2 | Lethal Weapon 2 (1989, 15 124) | Lethal Weapon 2 (1989, 15 124) | Lethal Weapon 2 (1989, 15 124) | Tomorrow Never Dies (1997, 14 288) | Tomorrow Never Dies (1997, 14 288) | Tomorrow Never Dies (1997, 14 288) |
| 3 | Starship Troopers (1997, 21 043) | Tomorrow Never Dies (1997, 14 288) | Tomorrow Never Dies (1997, 14 288) | Seven Samurai (1954, 16 531) | Seven Samurai (1954, 16 531) | **Star Trek VI: The Undiscovered Country (1991, 11 736)** |
| 4 | Batman (1989, 49 789) | Starship Troopers (1997, 21 043) | Starship Troopers (1997, 21 043) | The Godfather Part III (1990, 12 326) | **Star Trek VI: The Undiscovered Country (1991, 11 736)** | **Star Trek: Generations (1994, 27 773)** |
| 5 | Tomorrow Never Dies (1997, 14 288) | Batman (1989, 49 789) | The Last of the Mohicans (1992, 13 630) | Lethal Weapon 2 (1989, 15 124) | **Star Trek: Generations (1994, 27 773)** | **Under Siege (1992, 7 098)** |
| 6 | The Last of the Mohicans (1992, 13 630) | The Last of the Mohicans (1992, 13 630) | Batman (1989, 49 789) | The Godfather Part II (1974, 43 111) | Cliffhanger (1993, 25 769) | Seven Samurai (1954, 16 531) |
| 7 | The Untouchables (1987, 18 929) | In the Line of Fire (1993, 20 399) | In the Line of Fire (1993, 20 399) | Conan the Barbarian (1982, 8 273) | Conan the Barbarian (1982, 8 273) | Cliffhanger (1993, 25 769) |
| 8 | In the Line of Fire (1993, 20 399) | Star Trek VI: The Undiscovered Country (1991, 11 736) | Star Trek VI: The Undiscovered Country (1991, 11 736) | Cliffhanger (1993, 25 769) | Lethal Weapon 2 (1989, 15 124) | **Star Trek: The Motion Picture (1979, 10 727)** |
| 9 | The Godfather Part II (1974, 43 111) | **Star Trek: Generations (1994, 27 773)** | **Star Trek: Generations (1994, 27 773)** | Ben-Hur (1959, 10 165) | Ben-Hur (1959, 10 165) | Conan the Barbarian (1982, 8 273) |
| 10 | Star Trek VI: The Undiscovered Country (1991, 11 736) | The Untouchables (1987, 18 929) | **Cliffhanger (1993, 25 769)** | Starship Troopers (1997, 21 043) | **Under Siege (1992, 7 098)** | Ben-Hur (1959, 10 165) |

## Profil 3 — grand public (90e centile)

`userId` 37138 · 60 films en fold-in · popularité médiane du fold-in : 28 468 notes · note moyenne 3,75

Ses films les mieux notés (fold-in) : Mrs. Doubtfire (1993, 39 296) ; The Mask (1994, 40 007) ; Jurassic Park (1993, 75 233) ; The Lion King (1994, 51 518) ; Forrest Gump (1994, 100 296) ; Braveheart (1995, 69 482) ; Dumb and Dumber (1994, 36 802) ; Dances with Wolves (1990, 46 771)


**Source de popularité : `ml_rating_count`**

| # | A · λ = 0,0 | A · λ = 1,0 | A · λ = 2,0 | B · λ = 0,0 | B · λ = 1,0 | B · λ = 2,0 |
|---|---|---|---|---|---|---|
| 1 | Get Shorty (1995, 24 829) | Get Shorty (1995, 24 829) | Get Shorty (1995, 24 829) | Schindler's List (1993, 73 849) | Get Shorty (1995, 24 829) | Get Shorty (1995, 24 829) |
| 2 | Ghost (1990, 32 382) | Ghost (1990, 32 382) | Ghost (1990, 32 382) | Get Shorty (1995, 24 829) | Schindler's List (1993, 73 849) | Schindler's List (1993, 73 849) |
| 3 | Pretty Woman (1990, 39 189) | Pretty Woman (1990, 39 189) | Pretty Woman (1990, 39 189) | The Client (1994, 16 467) | The Client (1994, 16 467) | The Client (1994, 16 467) |
| 4 | Sleepless in Seattle (1993, 32 129) | Sleepless in Seattle (1993, 32 129) | Sleepless in Seattle (1993, 32 129) | Ghost (1990, 32 382) | Ghost (1990, 32 382) | Ghost (1990, 32 382) |
| 5 | The Client (1994, 16 467) | The Client (1994, 16 467) | The Client (1994, 16 467) | Pretty Woman (1990, 39 189) | Pretty Woman (1990, 39 189) | Pretty Woman (1990, 39 189) |
| 6 | Home Alone (1990, 34 648) | Home Alone (1990, 34 648) | Home Alone (1990, 34 648) | Sleepless in Seattle (1993, 32 129) | Sleepless in Seattle (1993, 32 129) | Sleepless in Seattle (1993, 32 129) |
| 7 | Species (1995, 14 662) | Species (1995, 14 662) | Species (1995, 14 662) | Home Alone (1990, 34 648) | Home Alone (1990, 34 648) | Home Alone (1990, 34 648) |
| 8 | Four Weddings and a Funeral (1994, 30 312) | Four Weddings and a Funeral (1994, 30 312) | Four Weddings and a Funeral (1994, 30 312) | Four Weddings and a Funeral (1994, 30 312) | Four Weddings and a Funeral (1994, 30 312) | Four Weddings and a Funeral (1994, 30 312) |
| 9 | Léon: The Professional (1994, 41 846) | Léon: The Professional (1994, 41 846) | Léon: The Professional (1994, 41 846) | Rob Roy (1995, 12 868) | Rob Roy (1995, 12 868) | Rob Roy (1995, 12 868) |
| 10 | Toy Story (1995, 68 997) | **Demolition Man (1993, 20 850)** | **Demolition Man (1993, 20 850)** | Demolition Man (1993, 20 850) | Demolition Man (1993, 20 850) | **The Piano (1993, 17 960)** |

**Source de popularité : `tmdb_vote_count`**

| # | A · λ = 0,0 | A · λ = 1,0 | A · λ = 2,0 | B · λ = 0,0 | B · λ = 1,0 | B · λ = 2,0 |
|---|---|---|---|---|---|---|
| 1 | Get Shorty (1995, 24 829) | Get Shorty (1995, 24 829) | Get Shorty (1995, 24 829) | Schindler's List (1993, 73 849) | Get Shorty (1995, 24 829) | Get Shorty (1995, 24 829) |
| 2 | Ghost (1990, 32 382) | Ghost (1990, 32 382) | Ghost (1990, 32 382) | Get Shorty (1995, 24 829) | Schindler's List (1993, 73 849) | The Client (1994, 16 467) |
| 3 | Pretty Woman (1990, 39 189) | Pretty Woman (1990, 39 189) | Sleepless in Seattle (1993, 32 129) | The Client (1994, 16 467) | The Client (1994, 16 467) | Schindler's List (1993, 73 849) |
| 4 | Sleepless in Seattle (1993, 32 129) | Sleepless in Seattle (1993, 32 129) | The Client (1994, 16 467) | Ghost (1990, 32 382) | Ghost (1990, 32 382) | Sleepless in Seattle (1993, 32 129) |
| 5 | The Client (1994, 16 467) | The Client (1994, 16 467) | Pretty Woman (1990, 39 189) | Pretty Woman (1990, 39 189) | Sleepless in Seattle (1993, 32 129) | Ghost (1990, 32 382) |
| 6 | Home Alone (1990, 34 648) | Home Alone (1990, 34 648) | Species (1995, 14 662) | Sleepless in Seattle (1993, 32 129) | Pretty Woman (1990, 39 189) | Rob Roy (1995, 12 868) |
| 7 | Species (1995, 14 662) | Species (1995, 14 662) | Home Alone (1990, 34 648) | Home Alone (1990, 34 648) | Four Weddings and a Funeral (1994, 30 312) | Four Weddings and a Funeral (1994, 30 312) |
| 8 | Four Weddings and a Funeral (1994, 30 312) | Four Weddings and a Funeral (1994, 30 312) | Four Weddings and a Funeral (1994, 30 312) | Four Weddings and a Funeral (1994, 30 312) | Rob Roy (1995, 12 868) | Pretty Woman (1990, 39 189) |
| 9 | Léon: The Professional (1994, 41 846) | Léon: The Professional (1994, 41 846) | **Rob Roy (1995, 12 868)** | Rob Roy (1995, 12 868) | Home Alone (1990, 34 648) | Home Alone (1990, 34 648) |
| 10 | Toy Story (1995, 68 997) | **Rob Roy (1995, 12 868)** | **I.Q. (1994, 10 334)** | Demolition Man (1993, 20 850) | **In the Line of Fire (1993, 20 399)** | **The Piano (1993, 17 960)** |
