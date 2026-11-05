# Header logo assets

`sundsvall-dragon.png` and `sundsvall-dragon-white.png` are the unmodified
`Fristaende drake_Svart.png` and `Fristaende drake_Vit.png` from Sundsvalls kommun's
[official logo page](https://sundsvall.se/kommun/kommun-och-politik/press--och-informationsmaterial/grafisk-profil/logotyp),
downloaded 2026-11-05 from
[Fristaende-drake.zip](https://sundsvall.se/download/18.235b114b198e57425bc786c7/1647599662158/Fristaende-drake.zip).
The original black image is 492 × 904 pixels; the header contains it without cropping or changing its proportions,
with token-based clearance following the [official illustration](https://sundsvall.se/images/18.235b114b198e57425bc5b302/1674553584583/Logotyp%20frizon%202023.PNG).

The dragon is Sundsvalls kommun's registered trademark (registration 257562). It is an organisation
asset, not an open-source dependency or a grant to use the symbol for another organisation. Other
installations choose `VITE_BRAND_PROFILE=neutral` or `custom`, and can supply their own authorised logo
through `VITE_HEADER_LOGO_SRC` and `VITE_HEADER_LOGO_ALT`; see the repository README. Only the Sundsvall
profile defaults to this symbol. No network request to Sundsvall is needed at runtime.

The header selects the original white variant in dark mode; neither asset is filtered or recoloured.
Other installations may set `VITE_HEADER_LOGO_DARK_SRC` alongside their own source and alt text.
