// =============================================================================
//  lib/services/conversion_service.dart
// =============================================================================
//  All conversions run fully offline. No server, no database, no analytics.
//
//  Threading: image decoding/encoding and PDF assembly are CPU-heavy, so they
//  run in a background isolate via compute(). Printing.raster() is the one
//  exception — it goes through a platform channel and therefore MUST stay on
//  the main isolate, but it streams page by page so the UI still breathes.
//
//  Output goes to the app's external files directory, which needs NO storage
//  permission on any Android version and is still visible to file managers
//  and the share sheet.
//
//  Merge/split use page templates rather than importPageRange, which does not
//  exist in syncfusion_flutter_pdf 34.x.
// =============================================================================

import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' show Offset, Size;

import 'package:flutter/foundation.dart';
import 'package:image/image.dart' as img;
import 'package:path_provider/path_provider.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:syncfusion_flutter_pdf/pdf.dart' as sf;

// =============================================================================
//  Types
// =============================================================================

enum ImageFormat { jpg, png, bmp, tiff, gif, ico }

extension ImageFormatX on ImageFormat {
  String get ext => name;
  String get label => switch (this) {
    ImageFormat.jpg => 'JPG',
    ImageFormat.png => 'PNG',
    ImageFormat.bmp => 'BMP',
    ImageFormat.tiff => 'TIFF',
    ImageFormat.gif => 'GIF',
    ImageFormat.ico => 'ICO',
  };
}

enum PageSizeOption { a4, letter, fitImage }

/// Thrown for anything the user should see a readable message about.
class ConversionException implements Exception {
  ConversionException(this.message);
  final String message;
  @override
  String toString() => message;
}

// =============================================================================
//  Service
// =============================================================================

class ConversionService {
  /// Where finished files land. No permission required.
  static Future<Directory> outputDir() async {
    final base = await getExternalStorageDirectory() ??
        await getApplicationDocumentsDirectory();
    final dir = Directory('${base.path}/PDF Toolkit');
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  static Future<File> _target(String name, String ext) async {
    final dir = await outputDir();
    final stamp = DateTime.now().millisecondsSinceEpoch.toRadixString(36);
    final safe = name.replaceAll(RegExp(r'[^\w\s.-]'), '_').trim();
    return File('${dir.path}/$safe-$stamp.$ext');
  }

  // ---------------------------------------------------------------------------
  //  1. Images -> PDF
  // ---------------------------------------------------------------------------

  static Future<File> imagesToPdf({
    required List<File> images,
    PageSizeOption pageSize = PageSizeOption.a4,
    double marginPt = 16,
    int jpegQuality = 85,
    String fileName = 'Images',
    void Function(int done, int total)? onProgress,
  }) async {
    if (images.isEmpty) {
      throw ConversionException('Select at least one image.');
    }

    final payload = <Uint8List>[];
    for (var i = 0; i < images.length; i++) {
      if (!await images[i].exists()) {
        throw ConversionException(
            '${images[i].path.split('/').last} is missing.');
      }
      payload.add(await images[i].readAsBytes());
      onProgress?.call(i + 1, images.length + 1);
    }

    final bytes = await compute(
      _buildPdf,
      _PdfBuildArgs(
        images: payload,
        pageSize: pageSize.index,
        marginPt: marginPt,
        quality: jpegQuality,
      ),
    );

    onProgress?.call(images.length + 1, images.length + 1);
    final out = await _target(fileName, 'pdf');
    await out.writeAsBytes(bytes);
    return out;
  }

  // ---------------------------------------------------------------------------
  //  2. PDF -> images   (main isolate: platform channel)
  // ---------------------------------------------------------------------------

  static Future<List<File>> pdfToImages({
    required File pdf,
    double dpi = 150,
    ImageFormat format = ImageFormat.png,
    int jpegQuality = 90,
    List<int>? pages, // 0-based; null = every page
    void Function(int done, int? total)? onProgress,
  }) async {
    if (!await pdf.exists()) {
      throw ConversionException('That PDF is no longer on the device.');
    }
    final bytes = await pdf.readAsBytes();
    final stem = pdf.path.split('/').last.replaceAll('.pdf', '');
    final dir = await outputDir();
    final stamp = DateTime.now().millisecondsSinceEpoch.toRadixString(36);

    final written = <File>[];
    var index = 0;

    try {
      await for (final page in Printing.raster(bytes, dpi: dpi, pages: pages)) {
        final png = await page.toPng();
        final Uint8List data = format == ImageFormat.png
            ? png
            : await compute(
          _reencode,
          _ReencodeArgs(
            bytes: png,
            format: format.index,
            quality: jpegQuality,
          ),
        );

        final n = (pages != null ? pages[index] : index) + 1;
        final f = File('${dir.path}/$stem-$stamp-p$n.${format.ext}');
        await f.writeAsBytes(data);
        written.add(f);
        index++;
        onProgress?.call(index, pages?.length);
      }
    } catch (e) {
      if (written.isEmpty) {
        throw ConversionException(
            'Could not read that PDF. It may be damaged or password protected.');
      }
    }

    if (written.isEmpty) {
      throw ConversionException('That PDF has no pages to export.');
    }
    return written;
  }

  // ---------------------------------------------------------------------------
  //  3. Image format conversion  +  4. compression
  // ---------------------------------------------------------------------------

  static Future<File> convertImage({
    required File source,
    required ImageFormat format,
    int quality = 90,
    int? maxDimension, // longest edge in px; null = keep original
  }) async {
    if (!await source.exists()) {
      throw ConversionException('That image is no longer on the device.');
    }
    final data = await compute(
      _reencode,
      _ReencodeArgs(
        bytes: await source.readAsBytes(),
        format: format.index,
        quality: quality,
        maxDimension: maxDimension,
      ),
    );
    final stem = source.path.split('/').last.split('.').first;
    final out = await _target(stem, format.ext);
    await out.writeAsBytes(data);
    return out;
  }

  static Future<File> compressImage({
    required File source,
    int quality = 70,
    int maxDimension = 1920,
  }) =>
      convertImage(
        source: source,
        format: ImageFormat.jpg,
        quality: quality,
        maxDimension: maxDimension,
      );

  // ---------------------------------------------------------------------------
  //  5. Merge PDFs
  // ---------------------------------------------------------------------------

  static Future<File> mergePdfs({
    required List<File> files,
    String fileName = 'Merged',
    void Function(int done, int total)? onProgress,
  }) async {
    if (files.length < 2) {
      throw ConversionException('Pick at least two PDFs to merge.');
    }

    final payload = <Uint8List>[];
    for (final f in files) {
      if (!await f.exists()) {
        throw ConversionException('${f.path.split('/').last} is missing.');
      }
      payload.add(await f.readAsBytes());
      onProgress?.call(payload.length, files.length);
    }

    final bytes = await compute(_merge, payload);
    final out = await _target(fileName, 'pdf');
    await out.writeAsBytes(bytes);
    return out;
  }

  // ---------------------------------------------------------------------------
  //  6. Split PDF  (1-based, inclusive page range)
  // ---------------------------------------------------------------------------

  static Future<File> splitPdf({
    required File pdf,
    required int fromPage,
    required int toPage,
  }) async {
    if (!await pdf.exists()) {
      throw ConversionException('That PDF is no longer on the device.');
    }
    final total = await pageCount(pdf);
    if (fromPage < 1 || toPage > total || fromPage > toPage) {
      throw ConversionException('Enter a page range between 1 and $total.');
    }

    final bytes = await compute(
      _split,
      _SplitArgs(
        bytes: await pdf.readAsBytes(),
        from: fromPage - 1,
        to: toPage - 1,
      ),
    );
    final stem = pdf.path.split('/').last.replaceAll('.pdf', '');
    final out = await _target('$stem p$fromPage-$toPage', 'pdf');
    await out.writeAsBytes(bytes);
    return out;
  }

  // ---------------------------------------------------------------------------
  //  Helpers
  // ---------------------------------------------------------------------------

  static Future<int> pageCount(File pdf) async {
    final doc = sf.PdfDocument(inputBytes: await pdf.readAsBytes());
    final n = doc.pages.count;
    doc.dispose();
    return n;
  }

  static Future<String> extractText(File pdf) async {
    final doc = sf.PdfDocument(inputBytes: await pdf.readAsBytes());
    final text = sf.PdfTextExtractor(doc).extractText();
    doc.dispose();
    return text;
  }

  static Future<void> printPdf(File pdf) async {
    final bytes = await pdf.readAsBytes();
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  static String humanSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}

// =============================================================================
//  Isolate entry points — must be top-level
// =============================================================================

class _PdfBuildArgs {
  const _PdfBuildArgs({
    required this.images,
    required this.pageSize,
    required this.marginPt,
    required this.quality,
  });
  final List<Uint8List> images;
  final int pageSize;
  final double marginPt;
  final int quality;
}

@pragma('vm:entry-point')
Future<Uint8List> _buildPdf(_PdfBuildArgs a) async {
  final doc = pw.Document();
  final option = PageSizeOption.values[a.pageSize];
  var added = 0;

  for (final raw in a.images) {
    final decoded = img.decodeImage(raw);
    if (decoded == null) continue;

    // Re-encode as JPEG so the PDF stays small regardless of source format.
    final jpeg = Uint8List.fromList(img.encodeJpg(decoded, quality: a.quality));
    final image = pw.MemoryImage(jpeg);

    final PdfPageFormat format = switch (option) {
      PageSizeOption.a4 => PdfPageFormat.a4,
      PageSizeOption.letter => PdfPageFormat.letter,
      PageSizeOption.fitImage => PdfPageFormat(
        decoded.width.toDouble(),
        decoded.height.toDouble(),
        marginAll: 0,
      ),
    };

    doc.addPage(
      pw.Page(
        pageFormat: format,
        margin: pw.EdgeInsets.all(
          option == PageSizeOption.fitImage ? 0 : a.marginPt,
        ),
        build: (_) => pw.Center(
          child: pw.Image(image, fit: pw.BoxFit.contain),
        ),
      ),
    );
    added++;
  }

  if (added == 0) {
    throw ConversionException('None of those files could be read as images.');
  }
  return doc.save();
}

class _ReencodeArgs {
  const _ReencodeArgs({
    required this.bytes,
    required this.format,
    required this.quality,
    this.maxDimension,
  });
  final Uint8List bytes;
  final int format;
  final int quality;
  final int? maxDimension;
}

@pragma('vm:entry-point')
Uint8List _reencode(_ReencodeArgs a) {
  var image = img.decodeImage(a.bytes);
  if (image == null) {
    throw ConversionException('That file is not a supported image.');
  }

  final limit = a.maxDimension;
  if (limit != null && (image.width > limit || image.height > limit)) {
    image = image.width >= image.height
        ? img.copyResize(image, width: limit)
        : img.copyResize(image, height: limit);
  }

  final out = switch (ImageFormat.values[a.format]) {
    ImageFormat.jpg => img.encodeJpg(image, quality: a.quality),
    ImageFormat.png => img.encodePng(image),
    ImageFormat.bmp => img.encodeBmp(image),
    ImageFormat.tiff => img.encodeTiff(image),
    ImageFormat.gif => img.encodeGif(image),
    ImageFormat.ico => img.encodeIco(image),
  };
  return Uint8List.fromList(out);
}

/// Copies every page of [source] onto [destination] as a drawn template.
/// syncfusion_flutter_pdf 34.x has no importPageRange, so this is the
/// supported way to move pages between documents.
void _copyPages(
    sf.PdfDocument source,
    sf.PdfDocument destination,
    int from,
    int to,
    ) {
  for (var i = from; i <= to; i++) {
    final template = source.pages[i].createTemplate();
    final page = destination.pages.add();
    page.graphics.drawPdfTemplate(
      template,
      const Offset(0, 0),
      Size(template.size.width, template.size.height),
    );
  }
}

@pragma('vm:entry-point')
Uint8List _merge(List<Uint8List> sources) {
  final merged = sf.PdfDocument();
  for (final bytes in sources) {
    final src = sf.PdfDocument(inputBytes: bytes);
    _copyPages(src, merged, 0, src.pages.count - 1);
    src.dispose();
  }
  final out = Uint8List.fromList(merged.saveSync());
  merged.dispose();
  return out;
}

class _SplitArgs {
  const _SplitArgs({required this.bytes, required this.from, required this.to});
  final Uint8List bytes;
  final int from, to;
}

@pragma('vm:entry-point')
Uint8List _split(_SplitArgs a) {
  final src = sf.PdfDocument(inputBytes: a.bytes);
  final out = sf.PdfDocument();
  _copyPages(src, out, a.from, a.to);
  final bytes = Uint8List.fromList(out.saveSync());
  src.dispose();
  out.dispose();
  return bytes;
}