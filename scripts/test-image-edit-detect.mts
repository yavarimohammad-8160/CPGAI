import {
  isImageEditAsk,
  isImageGenerateAsk,
  isImageWorkAsk,
  isSurgicalImageChange,
} from "../src/lib/image-work.ts";

const asks = [
  "این عکس رو ببین، قسمت بالا سمت چپ، خط دوم نوشته: «شرکت مهر پرتو تارا (میتا)»؛ این نوشته رو حذف کن. فقط همین که گفتم رو انجام بده و هیچ تغییر دیگه‌ای انجام نده.",
  "حالا همین عکس رو ببین، دوباره قسمت بالا سمت چپ، خط دوم نوشته رو حذف کن",
  "فونت همه متن‌های داخل عکس رو B Nazanin کن و RTL باشه",
  "آسمان این عکس منظره رو ابری‌تر کن",
  "یه پوستر صنعتی جدید بساز",
];
for (const a of asks) {
  console.log("---", a.slice(0, 50));
  console.log({
    surgical: isSurgicalImageChange(a),
    edit: isImageEditAsk(a, true),
    editNoImg: isImageEditAsk(a, false),
    gen: isImageGenerateAsk(a),
    work: isImageWorkAsk(a, [
      { role: "user", content: a, image: "/api/media/x.png" },
    ]),
  });
}
