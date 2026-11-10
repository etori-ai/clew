# Header logo assets

`sundsvall-dragon.png` and `sundsvall-dragon-white.png` are the unmodified
`Fristaende drake_Svart.png` and `Fristaende drake_Vit.png` from Sundsvalls kommun's
[official logo page](https://sundsvall.se/kommun/kommun-och-politik/press--och-informationsmaterial/grafisk-profil/logotyp),
downloaded 2026-11-05 from
[Fristaende-drake.zip](https://sundsvall.se/download/18.235b114b198e57425bc786c7/1647599662158/Fristaende-drake.zip).
The original black image is 492 × 904 pixels; the header contains it without cropping or changing its proportions,
with token-based clearance following the [official illustration](https://sundsvall.se/images/18.235b114b198e57425bc5b302/1674553584583/Logotyp%20frizon%202023.PNG).

The dragon is Sundsvalls kommun's registered trademark (registration 257562). It is an organisation
asset, not an open-source dependency or a grant to use the symbol for another organisation. An installation
uploads its own authorised logo on Administration › Utseende (D98); nothing in the product shows these two files by
default. They are here for the development stack: the intranet fixture connector names them as the header's logo
(`connectors/intranet/menu.json`), the example appearance `themes/sundsvall/appearance.json` names them as its logo,
and the browser suite's Sundsvall fixture uploads them. No network request to
Sundsvall is needed at runtime.

The header selects the white variant on dark ground; neither asset is filtered or recoloured.
