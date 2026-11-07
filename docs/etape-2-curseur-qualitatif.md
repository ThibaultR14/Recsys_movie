# Étape 2 · C4 — contrôle qualitatif du curseur (version 2 : variantes V1 / V2 / V3)

> Annexe de `docs/etape-2-modele.md` (section 5, C4 — complément). Générée par `uv run python slider_variants.py qualitative` puis `annex`, depuis `pipeline/data/processed/results/slider/variants_qualitative_test.json`. La version 1 (curseur D5 sur [−0,5 ; 2], deux sources) est dans l'historique git.

**Utilisateurs** : les 3 mêmes utilisateurs de **test** que la version 1 (40 à 400 films en fold-in, les plus proches du 10e / 50e / 90e centile de la popularité médiane de leur fold-in), pour A et B. Affichage uniquement, aucune métrique.

**Réglages** : pour chaque variante et chaque configuration, le réglage dont la `pop_mediane@20` de **validation** est la plus proche (échelle log) de 10 000, 2 000 et 500 notes. Popularité = `ml_rating_count` des utilisateurs d'entraînement. Chaque film : titre TMDB, année, nombre total de notes MovieLens.


## Réglages retenus

| Config | Variante | ≈ 10 000 | ≈ 2 000 | ≈ 500 |
|---|---|---|---|---|
| A | V1 | V1 λ=4 (11 018) | V1 λ=5 (2 594) | V1 λ=6 (709) |
| A | V2 | V2 K=500 λ=2.5 (10 215) | V2 K=500 λ=4 (1 932) | V2 K=500 λ=15 (1 791) |
| A | V3 | V3 plafond=10000 (7 464) | V3 plafond=2000 (1 624) | V3 plafond=500 (415) |
| B | V1 | V1 λ=3 (9 481) | V1 λ=4 (2 931) | V1 λ=5 (1 243) |
| B | V2 | V2 K=500 λ=2 (10 225) | V2 K=500 λ=4 (2 122) | V2 K=500 λ=30 (1 661) |
| B | V3 | V3 plafond=20000 (12 143) | V3 plafond=2000 (1 582) | V3 plafond=500 (400) |

Entre parenthèses : `pop_mediane@20` obtenue sur la validation.


## Profil 1 — le plus « pointu » (10e centile)

`userId` 28392 · 141 films en fold-in · popularité médiane du fold-in : 7 466 notes

Ses films les mieux notés : The Big Lebowski (1998, 36 349) ; Glengarry Glen Ross (1992, 7 205) ; Tinker Tailor Soldier Spy (2011, 3 379) ; Withnail & I (1987, 2 077) ; The Ipcress File (1965, 865) ; Performance. (1970, 223) ; The Grifters (1990, 6 821) ; Wild at Heart (1990, 2 533)


**V1**

| # | A · ≈ 10 000 | A · ≈ 2 000 | A · ≈ 500 | B · ≈ 10 000 | B · ≈ 2 000 | B · ≈ 500 |
|---|---|---|---|---|---|---|
| 1 | The Good, the Bad and the Ugly (1966, 22 922) | Fire and Ice: The Dragon Chronicles (2008, 20) | Fire and Ice: The Dragon Chronicles (2008, 20) | Fire and Ice: The Dragon Chronicles (2008, 20) | Fire and Ice: The Dragon Chronicles (2008, 20) | Fire and Ice: The Dragon Chronicles (2008, 20) |
| 2 | Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb (1964, 32 830) | The Stratton Story (1949, 20) | The Stratton Story (1949, 20) | The Stratton Story (1949, 20) | The Stratton Story (1949, 20) | The Stratton Story (1949, 20) |
| 3 | Life of Brian (1979, 27 292) | B/W (2015, 20) | B/W (2015, 20) | B/W (2015, 20) | B/W (2015, 20) | B/W (2015, 20) |
| 4 | Fire and Ice: The Dragon Chronicles (2008, 20) | Louis Theroux: Law and Disorder in Lagos (2010, 20) | Louis Theroux: Law and Disorder in Lagos (2010, 20) | Louis Theroux: Law and Disorder in Lagos (2010, 20) | Louis Theroux: Law and Disorder in Lagos (2010, 20) | Louis Theroux: Law and Disorder in Lagos (2010, 20) |
| 5 | The Stratton Story (1949, 20) | Love, Marilyn (2013, 20) | Love, Marilyn (2013, 20) | The Wizards Return: Alex vs. Alex (2013, 20) | Love, Marilyn (2013, 20) | Love, Marilyn (2013, 20) |
| 6 | B/W (2015, 20) | Killer Bean Forever (2008, 21) | Killer Bean Forever (2008, 21) | Killer Bean Forever (2008, 21) | Killer Bean Forever (2008, 21) | Killer Bean Forever (2008, 21) |
| 7 | Louis Theroux: Law and Disorder in Lagos (2010, 20) | Jesus Christ Superstar Live in Concert (2018, 20) | Jesus Christ Superstar Live in Concert (2018, 20) | Love, Marilyn (2013, 20) | The Witches (1966, 21) | The Witches (1966, 21) |
| 8 | Love, Marilyn (2013, 20) | Pocket Money (1972, 20) | Pocket Money (1972, 20) | The Witches (1966, 21) | Relative Strangers (2006, 20) | Relative Strangers (2006, 20) |
| 9 | Killer Bean Forever (2008, 21) | D-Day (2013, 20) | D-Day (2013, 20) | Relative Strangers (2006, 20) | The Wizards Return: Alex vs. Alex (2013, 20) | Jesus Christ Superstar Live in Concert (2018, 20) |
| 10 | Jesus Christ Superstar Live in Concert (2018, 20) | Relative Strangers (2006, 20) | Relative Strangers (2006, 20) | Jesus Christ Superstar Live in Concert (2018, 20) | Jesus Christ Superstar Live in Concert (2018, 20) | Pocket Money (1972, 20) |

**V2**

| # | A · ≈ 10 000 | A · ≈ 2 000 | A · ≈ 500 | B · ≈ 10 000 | B · ≈ 2 000 | B · ≈ 500 |
|---|---|---|---|---|---|---|
| 1 | The Good, the Bad and the Ugly (1966, 22 922) | The Long Goodbye (1973, 1 438) | The Last Detail (1973, 1 358) | The Great Escape (1963, 13 217) | Zulu (1964, 1 240) | In Cold Blood (1967, 1 098) |
| 2 | Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb (1964, 32 830) | The Last Detail (1973, 1 358) | The Long Goodbye (1973, 1 438) | Harold and Maude (1971, 9 462) | The Last Waltz (1978, 1 156) | Fail Safe (1964, 1 095) |
| 3 | Raging Bull (1980, 13 049) | Le Samouraï (1967, 1 506) | Straw Dogs (1971, 1 485) | The Conversation (1974, 5 693) | In Cold Blood (1967, 1 098) | Rififi (1955, 1 135) |
| 4 | A Fistful of Dollars (1964, 9 062) | McCabe & Mrs. Miller (1971, 1 697) | Le Samouraï (1967, 1 506) | All the President's Men (1976, 6 274) | Fail Safe (1964, 1 095) | The Last Waltz (1978, 1 156) |
| 5 | Life of Brian (1979, 27 292) | Straw Dogs (1971, 1 485) | The Discreet Charm of the Bourgeoisie (1972, 1 498) | Deliverance (1972, 9 488) | Three Days of the Condor (1975, 4 117) | The Caine Mutiny (1954, 1 207) |
| 6 | The Deer Hunter (1978, 13 621) | The Discreet Charm of the Bourgeoisie (1972, 1 498) | Stranger Than Paradise (1984, 1 519) | Three Days of the Condor (1975, 4 117) | Bullitt (1968, 2 233) | The Ladykillers (1955, 1 237) |
| 7 | The Conversation (1974, 5 693) | Stranger Than Paradise (1984, 1 519) | McCabe & Mrs. Miller (1971, 1 697) | American Graffiti (1973, 8 424) | The Ladykillers (1955, 1 237) | Zulu (1964, 1 240) |
| 8 | Lock, Stock and Two Smoking Barrels (1998, 24 152) | Fitzcarraldo (1982, 1 791) | Hud (1963, 1 711) | A Fistful of Dollars (1964, 9 062) | Rififi (1955, 1 135) | Hearts of Darkness: A Filmmaker's Apocalypse (1991, 1 287) |
| 9 | Butch Cassidy and the Sundance Kid (1969, 17 587) | Mystery Train (1989, 1 787) | Jeremiah Johnson (1972, 1 703) | Easy Rider (1969, 6 411) | The Caine Mutiny (1954, 1 207) | A Shot in the Dark (1964, 1 334) |
| 10 | The Long Goodbye (1973, 1 438) | Hud (1963, 1 711) | Repulsion (1965, 1 720) | Duck Soup (1933, 6 391) | The Conversation (1974, 5 693) | Babette's Feast (1987, 1 432) |

**V3**

| # | A · ≈ 10 000 | A · ≈ 2 000 | A · ≈ 500 | B · ≈ 10 000 | B · ≈ 2 000 | B · ≈ 500 |
|---|---|---|---|---|---|---|
| 1 | A Fistful of Dollars (1964, 9 062) | Bullitt (1968, 2 233) | Stroszek (1977, 523) | The Great Escape (1963, 13 217) | Bullitt (1968, 2 233) | Gregory's Girl (1980, 522) |
| 2 | Deliverance (1972, 9 488) | Fitzcarraldo (1982, 1 791) | Pickpocket (1959, 540) | Harold and Maude (1971, 9 462) | Gallipoli (1981, 2 093) | The Duellists (1977, 534) |
| 3 | Manhattan (1979, 10 130) | Days of Heaven (1978, 2 098) | Bob le Flambeur (1956, 468) | Deliverance (1972, 9 488) | A Night at the Opera (1935, 1 989) | The Man in the White Suit (1951, 533) |
| 4 | Patton (1970, 9 065) | Love and Death (1975, 2 136) | Point Blank (1967, 551) | American Graffiti (1973, 8 424) | The Battle of Algiers (1966, 1 883) | Monkey Business (1931, 518) |
| 5 | The Conversation (1974, 5 693) | La Dolce Vita (1960, 2 178) | The Passenger (1975, 544) | North by Northwest (1959, 20 093) | The Taking of Pelham One Two Three (1974, 2 007) | The Draughtsman's Contract (1982, 519) |
| 6 | Bonnie and Clyde (1967, 10 610) | McCabe & Mrs. Miller (1971, 1 697) | La Notte (1961, 498) | The Deer Hunter (1978, 13 621) | The Vanishing (1988, 1 940) | Angels with Dirty Faces (1938, 550) |
| 7 | Sleeper (1973, 7 594) | Mystery Train (1989, 1 787) | The Silence (1963, 547) | A Fistful of Dollars (1964, 9 062) | Tampopo (1985, 2 152) | Point Blank (1967, 551) |
| 8 | Easy Rider (1969, 6 411) | The Long Goodbye (1973, 1 438) | Bring Me the Head of Alfredo Garcia (1974, 424) | All the President's Men (1976, 6 274) | Breaker Morant (1980, 1 877) | Swimming to Cambodia (1987, 434) |
| 9 | Harold and Maude (1971, 9 462) | The Battle of Algiers (1966, 1 883) | Duck, You Sucker (1971, 535) | The Conversation (1974, 5 693) | La Dolce Vita (1960, 2 178) | Dark Passage (1947, 491) |
| 10 | On the Waterfront (1954, 6 982) | The Taking of Pelham One Two Three (1974, 2 007) | Au Hasard Balthazar (1966, 529) | Das Boot (1981, 15 804) | Fitzcarraldo (1982, 1 791) | Drowning by Numbers (1988, 424) |

## Profil 2 — médian (50e centile)

`userId` 94888 · 127 films en fold-in · popularité médiane du fold-in : 15 107 notes

Ses films les mieux notés : Indiana Jones and the Temple of Doom (1984, 29 294) ; Star Wars: Episode I - The Phantom Menace (1999, 37 973) ; The Hunt for Red October (1990, 26 219) ; Indiana Jones and the Last Crusade (1989, 46 401) ; Terminator 2: Judgment Day (1991, 68 383) ; Star Wars (1977, 85 010) ; Raiders of the Lost Ark (1981, 67 408) ; Three Kings (1999, 13 609)


**V1**

| # | A · ≈ 10 000 | A · ≈ 2 000 | A · ≈ 500 | B · ≈ 10 000 | B · ≈ 2 000 | B · ≈ 500 |
|---|---|---|---|---|---|---|
| 1 | Mission: Impossible (1996, 42 879) | Mission: Impossible (1996, 42 879) | Fire and Ice: The Dragon Chronicles (2008, 20) | The Last of the Mohicans (1992, 13 630) | Fire and Ice: The Dragon Chronicles (2008, 20) | Fire and Ice: The Dragon Chronicles (2008, 20) |
| 2 | Lethal Weapon 2 (1989, 15 124) | Lethal Weapon 2 (1989, 15 124) | The Stratton Story (1949, 20) | Tomorrow Never Dies (1997, 14 288) | The Stratton Story (1949, 20) | The Stratton Story (1949, 20) |
| 3 | Tomorrow Never Dies (1997, 14 288) | Tomorrow Never Dies (1997, 14 288) | Louis Theroux: Law and Disorder in Lagos (2010, 20) | Conan the Barbarian (1982, 8 273) | Louis Theroux: Law and Disorder in Lagos (2010, 20) | Louis Theroux: Law and Disorder in Lagos (2010, 20) |
| 4 | The Last of the Mohicans (1992, 13 630) | Fire and Ice: The Dragon Chronicles (2008, 20) | Love, Marilyn (2013, 20) | Under Siege (1992, 7 098) | Love, Marilyn (2013, 20) | Love, Marilyn (2013, 20) |
| 5 | Starship Troopers (1997, 21 043) | The Stratton Story (1949, 20) | B/W (2015, 20) | Ben-Hur (1959, 10 165) | A Man There Was (1917, 20) | A Man There Was (1917, 20) |
| 6 | Star Trek VI: The Undiscovered Country (1991, 11 736) | The Last of the Mohicans (1992, 13 630) | Séance (2004, 20) | Seven Samurai (1954, 16 531) | La Roue (1923, 20) | La Roue (1923, 20) |
| 7 | Batman (1989, 49 789) | Louis Theroux: Law and Disorder in Lagos (2010, 20) | Wild Tigers I Have Known (2006, 20) | The Godfather Part III (1990, 12 326) | Jesus Christ Superstar Live in Concert (2018, 20) | Jesus Christ Superstar Live in Concert (2018, 20) |
| 8 | The Untouchables (1987, 18 929) | Love, Marilyn (2013, 20) | Fun Mom Dinner (2017, 20) | Fire and Ice: The Dragon Chronicles (2008, 20) | Séance (2004, 20) | B/W (2015, 20) |
| 9 | The Mask of Zorro (1998, 16 068) | B/W (2015, 20) | Jesus Christ Superstar Live in Concert (2018, 20) | The Stratton Story (1949, 20) | D-Day (2013, 20) | Séance (2004, 20) |
| 10 | In the Line of Fire (1993, 20 399) | Séance (2004, 20) | La Roue (1923, 20) | Star Trek VI: The Undiscovered Country (1991, 11 736) | City Limits (1985, 20) | D-Day (2013, 20) |

**V2**

| # | A · ≈ 10 000 | A · ≈ 2 000 | A · ≈ 500 | B · ≈ 10 000 | B · ≈ 2 000 | B · ≈ 500 |
|---|---|---|---|---|---|---|
| 1 | Tomorrow Never Dies (1997, 14 288) | Nighthawks (1981, 865) | Nighthawks (1981, 865) | The Last of the Mohicans (1992, 13 630) | Earthquake (1974, 751) | Earthquake (1974, 751) |
| 2 | Lethal Weapon 2 (1989, 15 124) | Force 10 from Navarone (1978, 1 098) | Force 10 from Navarone (1978, 1 098) | Tomorrow Never Dies (1997, 14 288) | Davy Crockett, King of the Wild Frontier (1955, 825) | The Incredible Journey (1963, 802) |
| 3 | The Last of the Mohicans (1992, 13 630) | Marked for Death (1990, 1 121) | The Cowboy Way (1994, 1 088) | Conan the Barbarian (1982, 8 273) | Nighthawks (1981, 865) | Davy Crockett, King of the Wild Frontier (1955, 825) |
| 4 | Mission: Impossible (1996, 42 879) | The Cowboy Way (1994, 1 088) | Marked for Death (1990, 1 121) | Under Siege (1992, 7 098) | The Emerald Forest (1985, 1 003) | Fire Down Below (1997, 812) |
| 5 | Starship Troopers (1997, 21 043) | The Corruptor (1999, 1 120) | The Corruptor (1999, 1 120) | The Longest Day (1962, 3 093) | The Incredible Journey (1963, 802) | Nighthawks (1981, 865) |
| 6 | Star Trek VI: The Undiscovered Country (1991, 11 736) | Operation Condor (1991, 1 176) | Operation Condor (1991, 1 176) | Ben-Hur (1959, 10 165) | Fire Down Below (1997, 812) | Condorman (1981, 876) |
| 7 | Nighthawks (1981, 865) | The Getaway (1994, 1 182) | The Getaway (1994, 1 182) | The Godfather Part III (1990, 12 326) | The Apple Dumpling Gang Rides Again (1979, 884) | The Apple Dumpling Gang Rides Again (1979, 884) |
| 8 | Under Siege (1992, 7 098) | Running Scared (1986, 1 402) | No Escape (1994, 1 218) | Seven Samurai (1954, 16 531) | Force 10 from Navarone (1978, 1 098) | King Kong vs. Godzilla (1963, 910) |
| 9 | Force 10 from Navarone (1978, 1 098) | No Escape (1994, 1 218) | Judgment Night (1993, 1 293) | Star Trek VI: The Undiscovered Country (1991, 11 736) | Condorman (1981, 876) | For Whom the Bell Tolls (1943, 904) |
| 10 | Live and Let Die (1973, 5 787) | The Presidio (1988, 1 356) | The Old Man and the Sea (1958, 1 311) | Live and Let Die (1973, 5 787) | King Kong vs. Godzilla (1963, 910) | Herbie Goes to Monte Carlo (1977, 949) |

**V3**

| # | A · ≈ 10 000 | A · ≈ 2 000 | A · ≈ 500 | B · ≈ 10 000 | B · ≈ 2 000 | B · ≈ 500 |
|---|---|---|---|---|---|---|
| 1 | Ben-Hur (1959, 10 165) | The Towering Inferno (1974, 2 201) | Firestorm (1998, 496) | The Last of the Mohicans (1992, 13 630) | The Towering Inferno (1974, 2 201) | Pork Chop Hill (1959, 504) |
| 2 | Patriot Games (1992, 10 572) | Tequila Sunrise (1988, 2 125) | Captain Horatio Hornblower R.N. (1951, 444) | Tomorrow Never Dies (1997, 14 288) | Red Sonja (1985, 1 894) | Captain Horatio Hornblower R.N. (1951, 444) |
| 3 | Dr. No (1962, 8 898) | Red Sonja (1985, 1 894) | The Bridge at Remagen (1969, 361) | Seven Samurai (1954, 16 531) | Runaway Train (1985, 1 811) | Firestorm (1998, 496) |
| 4 | Star Trek: The Motion Picture (1979, 10 727) | Running Scared (1986, 1 402) | Flying Tigers (1942, 332) | The Godfather Part III (1990, 12 326) | Battle for the Planet of the Apes (1973, 2 230) | The Bridge at Remagen (1969, 361) |
| 5 | Under Siege (1992, 7 098) | Battle for the Planet of the Apes (1973, 2 230) | Pork Chop Hill (1959, 504) | Lethal Weapon 2 (1989, 15 124) | The 7th Voyage of Sinbad (1958, 1 661) | Flying Tigers (1942, 332) |
| 6 | Conan the Barbarian (1982, 8 273) | Runaway Train (1985, 1 811) | The Fighting Seabees (1944, 294) | Conan the Barbarian (1982, 8 273) | Tequila Sunrise (1988, 2 125) | The Fighting Seabees (1944, 294) |
| 7 | The World Is Not Enough (1999, 10 496) | Conquest of the Planet of the Apes (1972, 2 208) | Missing in Action 2: The Beginning (1985, 492) | Ben-Hur (1959, 10 165) | Titanic (1953, 1 735) | Angel and the Badman (1947, 362) |
| 8 | Live and Let Die (1973, 5 787) | Force 10 from Navarone (1978, 1 098) | Death Wish II (1982, 556) | Starship Troopers (1997, 21 043) | Mutiny on the Bounty (1935, 2 030) | A Farewell to Arms (1932, 467) |
| 9 | The Negotiator (1998, 10 438) | The Presidio (1988, 1 356) | Black Dog (1998, 484) | Star Trek VI: The Undiscovered Country (1991, 11 736) | Running Scared (1986, 1 402) | Missing in Action 2: The Beginning (1985, 492) |
| 10 | A Fistful of Dollars (1964, 9 062) | The 7th Voyage of Sinbad (1958, 1 661) | Braddock: Missing in Action III (1988, 389) | Ronin (1998, 11 672) | Conquest of the Planet of the Apes (1972, 2 208) | Son of Flubber (1963, 487) |

## Profil 3 — grand public (90e centile)

`userId` 37138 · 60 films en fold-in · popularité médiane du fold-in : 28 468 notes

Ses films les mieux notés : Mrs. Doubtfire (1993, 39 296) ; The Mask (1994, 40 007) ; Jurassic Park (1993, 75 233) ; The Lion King (1994, 51 518) ; Forrest Gump (1994, 100 296) ; Braveheart (1995, 69 482) ; Dumb and Dumber (1994, 36 802) ; Dances with Wolves (1990, 46 771)


**V1**

| # | A · ≈ 10 000 | A · ≈ 2 000 | A · ≈ 500 | B · ≈ 10 000 | B · ≈ 2 000 | B · ≈ 500 |
|---|---|---|---|---|---|---|
| 1 | Get Shorty (1995, 24 829) | Get Shorty (1995, 24 829) | Get Shorty (1995, 24 829) | Get Shorty (1995, 24 829) | Get Shorty (1995, 24 829) | Get Shorty (1995, 24 829) |
| 2 | Ghost (1990, 32 382) | Ghost (1990, 32 382) | Ghost (1990, 32 382) | The Client (1994, 16 467) | The Client (1994, 16 467) | The Client (1994, 16 467) |
| 3 | Pretty Woman (1990, 39 189) | The Client (1994, 16 467) | The Client (1994, 16 467) | Schindler's List (1993, 73 849) | Schindler's List (1993, 73 849) | Ghost (1990, 32 382) |
| 4 | The Client (1994, 16 467) | Pretty Woman (1990, 39 189) | Pretty Woman (1990, 39 189) | Ghost (1990, 32 382) | Ghost (1990, 32 382) | Schindler's List (1993, 73 849) |
| 5 | Sleepless in Seattle (1993, 32 129) | Sleepless in Seattle (1993, 32 129) | Sleepless in Seattle (1993, 32 129) | Pretty Woman (1990, 39 189) | Rob Roy (1995, 12 868) | Rob Roy (1995, 12 868) |
| 6 | Species (1995, 14 662) | Species (1995, 14 662) | Species (1995, 14 662) | Sleepless in Seattle (1993, 32 129) | Sleepless in Seattle (1993, 32 129) | Sleepless in Seattle (1993, 32 129) |
| 7 | Home Alone (1990, 34 648) | Home Alone (1990, 34 648) | Home Alone (1990, 34 648) | Home Alone (1990, 34 648) | Pretty Woman (1990, 39 189) | Pretty Woman (1990, 39 189) |
| 8 | Four Weddings and a Funeral (1994, 30 312) | Four Weddings and a Funeral (1994, 30 312) | Fire and Ice: The Dragon Chronicles (2008, 20) | Rob Roy (1995, 12 868) | Home Alone (1990, 34 648) | Home Alone (1990, 34 648) |
| 9 | Léon: The Professional (1994, 41 846) | Rob Roy (1995, 12 868) | The Stratton Story (1949, 20) | Four Weddings and a Funeral (1994, 30 312) | Four Weddings and a Funeral (1994, 30 312) | Four Weddings and a Funeral (1994, 30 312) |
| 10 | Rob Roy (1995, 12 868) | Léon: The Professional (1994, 41 846) | Four Weddings and a Funeral (1994, 30 312) | The Piano (1993, 17 960) | The Piano (1993, 17 960) | The Piano (1993, 17 960) |

**V2**

| # | A · ≈ 10 000 | A · ≈ 2 000 | A · ≈ 500 | B · ≈ 10 000 | B · ≈ 2 000 | B · ≈ 500 |
|---|---|---|---|---|---|---|
| 1 | Get Shorty (1995, 24 829) | Get Shorty (1995, 24 829) | Man of the House (1995, 1 296) | The Client (1994, 16 467) | 13 Ghosts (1960, 799) | 13 Ghosts (1960, 799) |
| 2 | Ghost (1990, 32 382) | Man of the House (1995, 1 296) | The Invisible Guest (2017, 1 343) | Get Shorty (1995, 24 829) | Bud Abbott and Lou Costello Meet Frankenstein (1948, 1 066) | Bud Abbott and Lou Costello Meet Frankenstein (1948, 1 066) |
| 3 | The Client (1994, 16 467) | The Invisible Guest (2017, 1 343) | Another Round (2020, 1 375) | Rob Roy (1995, 12 868) | The 7th Voyage of Sinbad (1958, 1 661) | Air Bud (1997, 1 629) |
| 4 | Species (1995, 14 662) | The Client (1994, 16 467) | The War (1994, 1 499) | Ghost (1990, 32 382) | Air Bud (1997, 1 629) | The Adventures of Milo and Otis (1986, 1 660) |
| 5 | Sleepless in Seattle (1993, 32 129) | Another Round (2020, 1 375) | Village of the Damned (1960, 1 574) | The Piano (1993, 17 960) | The Adventures of Milo and Otis (1986, 1 660) | The 7th Voyage of Sinbad (1958, 1 661) |
| 6 | Pretty Woman (1990, 39 189) | Village of the Damned (1960, 1 574) | Fantastic Planet (1973, 1 560) | Sleepless in Seattle (1993, 32 129) | Jeremiah Johnson (1972, 1 703) | Jeremiah Johnson (1972, 1 703) |
| 7 | Under Siege 2: Dark Territory (1995, 8 795) | The War (1994, 1 499) | Virus (1999, 1 545) | I.Q. (1994, 10 334) | The Client (1994, 16 467) | Air America (1990, 1 757) |
| 8 | I.Q. (1994, 10 334) | Fantastic Planet (1973, 1 560) | Them! (1954, 1 678) | In the Line of Fire (1993, 20 399) | 3000 Miles to Graceland (2001, 1 746) | 3000 Miles to Graceland (2001, 1 746) |
| 9 | Rob Roy (1995, 12 868) | Virus (1999, 1 545) | Bad Girls (1994, 1 799) | Demolition Man (1993, 20 850) | Air America (1990, 1 757) | Black Beauty (1994, 1 832) |
| 10 | Nine Months (1995, 11 491) | Ghost (1990, 32 382) | A Kid in King Arthur's Court (1995, 1 807) | Four Weddings and a Funeral (1994, 30 312) | Rob Roy (1995, 12 868) | Cops & Robbersons (1994, 1 856) |

**V3**

| # | A · ≈ 10 000 | A · ≈ 2 000 | A · ≈ 500 | B · ≈ 10 000 | B · ≈ 2 000 | B · ≈ 500 |
|---|---|---|---|---|---|---|
| 1 | I.Q. (1994, 10 334) | Cops & Robbersons (1994, 1 856) | Capernaum (2018, 460) | The Client (1994, 16 467) | Hang 'em High (1968, 1 876) | Zindagi Na Milegi Dobara (2011, 282) |
| 2 | Under Siege 2: Dark Territory (1995, 8 795) | Jade (1995, 2 178) | Trial by Jury (1994, 514) | Rob Roy (1995, 12 868) | The 7th Voyage of Sinbad (1958, 1 661) | Gordy (1995, 470) |
| 3 | Junior (1994, 10 683) | Jury Duty (1995, 2 186) | Earth vs. the Flying Saucers (1956, 404) | Demolition Man (1993, 20 850) | Cops & Robbersons (1994, 1 856) | About Elly (2009, 481) |
| 4 | Little Women (1994, 10 899) | Altered States (1980, 1 961) | Gordy (1995, 470) | In the Line of Fire (1993, 20 399) | True Grit (1969, 2 147) | Five Feet Apart (2019, 342) |
| 5 | Dangerous Minds (1995, 10 223) | The Omega Man (1971, 1 929) | Dangal (2016, 548) | The Piano (1993, 17 960) | Jeremiah Johnson (1972, 1 703) | Anna Karenina (1997, 363) |
| 6 | Copycat (1995, 10 317) | Man of the House (1995, 1 296) | Summer of '42 (1971, 410) | Ed Wood (1994, 17 428) | The Adventures of Milo and Otis (1986, 1 660) | Rang De Basanti (2006, 353) |
| 7 | Drop Zone (1994, 4 689) | Village of the Damned (1960, 1 574) | The Sand Pebbles (1966, 501) | Species (1995, 14 662) | 3000 Miles to Graceland (2001, 1 746) | The Salesman (2016, 544) |
| 8 | Miracle on 34th Street (1994, 9 590) | 3 Idiots (2009, 2 147) | Who Am I (2014, 554) | I.Q. (1994, 10 334) | Black Beauty (1994, 1 832) | 10 Items or Less (2006, 503) |
| 9 | Don Juan DeMarco (1994, 8 731) | Hellraiser: Bloodline (1996, 1 951) | Drive My Car (2021, 533) | Nine Months (1995, 11 491) | Tora! Tora! Tora! (1970, 2 137) | All the Real Girls (2003, 477) |
| 10 | Milk Money (1994, 5 487) | Fantastic Voyage (1966, 1 821) | The Day of the Triffids (1963, 441) | Maverick (1994, 18 685) | Altered States (1980, 1 961) | Cats Don't Dance (1997, 492) |
