import JSZip from "jszip";

export type NativeChartKind = "pie" | "bar" | "line";

export type NativeChartSpec = {
  type: NativeChartKind;
  title: string;
  /** Sheet display name as shown in Excel (e.g. داده نمودار) */
  sheetName: string;
  /** 1-based inclusive data rows for categories/values (no header) */
  firstDataRow: number;
  lastDataRow: number;
  /** Category column letter, e.g. "B" */
  catCol: string;
  /** Value column letter, e.g. "C" */
  valCol: string;
  /** Series title cell, e.g. "C3" (header of values) — optional */
  seriesTitleCell?: string;
};

function xmlEscape(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sheetRef(sheetName: string, a1: string) {
  const safe = String(sheetName || "Sheet1").replace(/'/g, "''");
  return `'${safe}'!${a1}`;
}

function buildChartXml(spec: NativeChartSpec) {
  const title = xmlEscape(spec.title || "Chart");
  const cat =
    `${spec.catCol}${spec.firstDataRow}:${spec.catCol}${spec.lastDataRow}`;
  const val =
    `${spec.valCol}${spec.firstDataRow}:${spec.valCol}${spec.lastDataRow}`;
  const catF = xmlEscape(sheetRef(spec.sheetName, cat));
  const valF = xmlEscape(sheetRef(spec.sheetName, val));
  const serTx = spec.seriesTitleCell
    ? `<c:tx><c:strRef><c:f>${xmlEscape(
        sheetRef(spec.sheetName, spec.seriesTitleCell)
      )}</c:f></c:strRef></c:tx>`
    : `<c:tx><c:v>${xmlEscape("مقدار")}</c:v></c:tx>`;

  const ser = `
      <c:ser>
        <c:idx val="0"/>
        <c:order val="0"/>
        ${serTx}
        <c:cat><c:strRef><c:f>${catF}</c:f></c:strRef></c:cat>
        <c:val><c:numRef><c:f>${valF}</c:f></c:numRef></c:val>
      </c:ser>`;

  let plotInner = "";
  if (spec.type === "pie") {
    plotInner = `
      <c:pieChart>
        <c:varyColors val="1"/>
        ${ser}
        <c:dLbls>
          <c:showLegendKey val="0"/>
          <c:showVal val="0"/>
          <c:showCatName val="1"/>
          <c:showPercent val="1"/>
          <c:showSerName val="0"/>
        </c:dLbls>
      </c:pieChart>`;
  } else if (spec.type === "line") {
    plotInner = `
      <c:lineChart>
        <c:grouping val="standard"/>
        ${ser}
        <c:marker val="1"/>
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:lineChart>
      <c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:majorTickMark val="out"/>
        <c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/>
        <c:crossAx val="2"/>
        <c:crosses val="autoZero"/>
        <c:auto val="1"/>
        <c:lblAlgn val="ctr"/>
        <c:lblOffset val="100"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:majorGridlines/>
        <c:majorTickMark val="out"/>
        <c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/>
        <c:crossAx val="1"/>
        <c:crosses val="autoZero"/>
        <c:crossBetween val="between"/>
      </c:valAx>`;
  } else {
    plotInner = `
      <c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="clustered"/>
        <c:varyColors val="0"/>
        ${ser}
        <c:dLbls>
          <c:showLegendKey val="0"/>
          <c:showVal val="1"/>
          <c:showCatName val="0"/>
          <c:showSerName val="0"/>
          <c:showPercent val="0"/>
        </c:dLbls>
        <c:gapWidth val="150"/>
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:barChart>
      <c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:majorTickMark val="out"/>
        <c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/>
        <c:crossAx val="2"/>
        <c:crosses val="autoZero"/>
        <c:auto val="1"/>
        <c:lblAlgn val="ctr"/>
        <c:lblOffset val="100"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:majorGridlines/>
        <c:majorTickMark val="out"/>
        <c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/>
        <c:crossAx val="1"/>
        <c:crosses val="autoZero"/>
        <c:crossBetween val="between"/>
      </c:valAx>`;
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    <c:title>
      <c:tx>
        <c:rich>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:pPr><a:defRPr sz="1400" b="1"/></a:pPr>
            <a:r><a:rPr lang="fa-IR" sz="1400" b="1"/><a:t>${title}</a:t></a:r>
          </a:p>
        </c:rich>
      </c:tx>
      <c:overlay val="0"/>
    </c:title>
    <c:autoTitleDeleted val="0"/>
    <c:plotArea>
      <c:layout/>
      ${plotInner}
    </c:plotArea>
    <c:legend>
      <c:legendPos val="b"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
  </c:chart>
</c:chartSpace>`;
}

function buildDrawingXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:twoCellAnchor>
    <xdr:from>
      <xdr:col>5</xdr:col>
      <xdr:colOff>0</xdr:colOff>
      <xdr:row>2</xdr:row>
      <xdr:rowOff>0</xdr:rowOff>
    </xdr:from>
    <xdr:to>
      <xdr:col>14</xdr:col>
      <xdr:colOff>0</xdr:colOff>
      <xdr:row>18</xdr:row>
      <xdr:rowOff>0</xdr:rowOff>
    </xdr:to>
    <xdr:graphicFrame>
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="2" name="Chart 1"/>
        <xdr:cNvGraphicFramePr/>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm>
        <a:off x="0" y="0"/>
        <a:ext cx="0" cy="0"/>
      </xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:chart r:id="rId1"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`;
}

function nextRid(relsXml: string) {
  let max = 0;
  const re = /Id="rId(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(relsXml))) {
    max = Math.max(max, Number(m[1]) || 0);
  }
  return max + 1;
}

function ensureContentType(
  typesXml: string,
  partName: string,
  contentType: string
) {
  if (typesXml.includes(`PartName="${partName}"`)) return typesXml;
  return typesXml.replace(
    "</Types>",
    `  <Override PartName="${partName}" ContentType="${contentType}"/>\n</Types>`
  );
}

/**
 * Inject a native Excel chart into the first worksheet of an xlsx buffer
 * produced by ExcelJS (or compatible OOXML).
 */
export async function injectNativeExcelChart(
  xlsxBuffer: Buffer,
  spec: NativeChartSpec
): Promise<Buffer> {
  if (spec.lastDataRow < spec.firstDataRow) {
    return xlsxBuffer;
  }

  const zip = await JSZip.loadAsync(xlsxBuffer);

  const wbRelsPath = "xl/_rels/workbook.xml.rels";
  const wbRels = await zip.file(wbRelsPath)?.async("string");
  if (!wbRels) return xlsxBuffer;

  // First worksheet Target, usually worksheets/sheet1.xml
  const sheetMatch = wbRels.match(
    /Type="[^"]*worksheet"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Type="[^"]*worksheet"/
  );
  let sheetTarget =
    (sheetMatch && (sheetMatch[1] || sheetMatch[2])) || "worksheets/sheet1.xml";
  if (sheetTarget.startsWith("/")) sheetTarget = sheetTarget.slice(1);
  if (!sheetTarget.startsWith("xl/") && !sheetTarget.startsWith("worksheets/")) {
    // relative to xl/
  }
  const sheetPath = sheetTarget.startsWith("xl/")
    ? sheetTarget
    : `xl/${sheetTarget.replace(/^\.\//, "")}`;

  const sheetXml = await zip.file(sheetPath)?.async("string");
  if (!sheetXml) return xlsxBuffer;

  // Unique-ish chart/drawing names to avoid colliding with ExcelJS images on other sheets
  const chartPath = "xl/charts/chart_cpgai1.xml";
  const drawingPath = "xl/drawings/drawing_cpgai1.xml";
  const drawingRelsPath = "xl/drawings/_rels/drawing_cpgai1.xml.rels";

  const sheetDir = sheetPath.replace(/[^/]+$/, "");
  const sheetNameOnly = sheetPath.split("/").pop() || "sheet1.xml";
  const sheetRelsPath = `${sheetDir}_rels/${sheetNameOnly}.rels`;

  let sheetRels = (await zip.file(sheetRelsPath)?.async("string")) ||
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n</Relationships>`;

  const rid = nextRid(sheetRels);
  const drawingRid = `rId${rid}`;
  // Target relative from xl/worksheets/_rels/ to xl/drawings/
  const drawingRelTarget = `../drawings/drawing_cpgai1.xml`;

  if (!sheetRels.includes("drawing_cpgai1.xml")) {
    sheetRels = sheetRels.replace(
      "</Relationships>",
      `  <Relationship Id="${drawingRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="${drawingRelTarget}"/>\n</Relationships>`
    );
  }

  let newSheetXml = sheetXml;
  if (!/drawing[^>]*r:id=/i.test(sheetXml)) {
    if (sheetXml.includes("</worksheet>")) {
      newSheetXml = sheetXml.replace(
        "</worksheet>",
        `  <drawing r:id="${drawingRid}"/>\n</worksheet>`
      );
    }
  } else if (!sheetXml.includes("drawing_cpgai1")) {
    // already has a drawing (e.g. image) — append another drawing element if possible
    // Excel allows one <drawing>; if present, skip injecting second and put chart on that drawing instead — too hard.
    // Prefer: if drawing exists on THIS sheet, don't double. Our data sheet usually has no image.
  }

  // Ensure r namespace on worksheet root if missing
  if (
    newSheetXml.includes("<drawing ") &&
    !/xmlns:r=/.test(newSheetXml.match(/<worksheet[^>]*>/)?.[0] || "")
  ) {
    newSheetXml = newSheetXml.replace(
      /<worksheet([^>]*)>/,
      '<worksheet$1 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    );
  }

  const drawingXml = buildDrawingXml();
  const drawingRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart_cpgai1.xml"/>
</Relationships>`;
  const chartXml = buildChartXml(spec);

  let types =
    (await zip.file("[Content_Types].xml")?.async("string")) || "";
  types = ensureContentType(
    types,
    "/xl/charts/chart_cpgai1.xml",
    "application/vnd.openxmlformats-officedocument.drawingml.chart+xml"
  );
  types = ensureContentType(
    types,
    "/xl/drawings/drawing_cpgai1.xml",
    "application/vnd.openxmlformats-officedocument.drawing+xml"
  );

  zip.file(sheetPath, newSheetXml);
  zip.file(sheetRelsPath, sheetRels);
  zip.file(drawingPath, drawingXml);
  zip.file(drawingRelsPath, drawingRels);
  zip.file(chartPath, chartXml);
  zip.file("[Content_Types].xml", types);

  const out = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  return Buffer.from(out);
}
