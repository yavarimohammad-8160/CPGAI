import { isChartAsk, looksLikeMatplotlibDump } from "../src/lib/chart-render.ts";
console.log(isChartAsk("میتونی نمودار برام ترسیم کنی"));
console.log(looksLikeMatplotlibDump("import matplotlib.pyplot as plt\nplt.pie(sizes)"));
