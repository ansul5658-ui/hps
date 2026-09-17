// =============================================================================
//  lib/screens/tools/tools_screen.dart
// =============================================================================
//  The converter hub. Every tool here is a real flow: pick input, choose
//  options, run in the background, share the result. No placeholder buttons.
//
//  Colours come from Theme.of(context), so this inherits your existing
//  AppTheme identity in both light and dark mode without duplicating tokens.
// =============================================================================

import 'dart:io';
import 'package:cunning_document_scanner/cunning_document_scanner.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart' as picker;
import 'package:share_plus/share_plus.dart';

import '../services/conversion_service.dart';

class ToolsScreen extends StatelessWidget {
  const ToolsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tools = <_Tool>[

      _Tool('Scan document', 'Camera to clean PDF', Icons.document_scanner_outlined,
          _scanToPdf),
      _Tool('Images to PDF', 'Photos into one file', Icons.picture_as_pdf_outlined,
          _imagesToPdf),
      _Tool('PDF to images', 'Export pages as PNG or JPG', Icons.image_outlined,
          _pdfToImages),
      _Tool('Convert image', 'JPG, PNG, BMP, TIFF, GIF', Icons.swap_horiz,
          _convertImage),
      _Tool('Compress image', 'Smaller file, same look', Icons.compress,
          _compressImage),
      _Tool('Merge PDFs', 'Several files into one', Icons.merge_type,
          _mergePdfs),
      _Tool('Split PDF', 'Pull out a page range', Icons.content_cut,
          _splitPdf),
    ];

    return Scaffold(
      appBar: AppBar(title: const Text('Tools')),
      body: GridView.builder(
        padding: const EdgeInsets.all(16),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 1.05,
        ),
        itemCount: tools.length,
        itemBuilder: (context, i) {
          final t = tools[i];
          return Material(
            color: cs.surfaceContainerHighest.withOpacity(0.45),
            borderRadius: BorderRadius.circular(16),
            child: InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: () => t.run(context),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: cs.primary.withOpacity(0.14),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Icon(t.icon, color: cs.primary, size: 22),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(t.title,
                            style: Theme.of(context)
                                .textTheme
                                .titleSmall
                                ?.copyWith(fontWeight: FontWeight.w600)),
                        const SizedBox(height: 2),
                        Text(t.subtitle,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _Tool {
  const _Tool(this.title, this.subtitle, this.icon, this.run);
  final String title;
  final String subtitle;
  final IconData icon;
  final Future<void> Function(BuildContext) run;
}

// =============================================================================
//  FLOWS
// =============================================================================

Future<void> _scanToPdf(BuildContext context) async {
  List<String>? shots;
  try {
    shots = await CunningDocumentScanner.getPictures(
      noOfPages: 20,
      isGalleryImportAllowed: true,
    );
  } catch (_) {
    if (context.mounted) _snack(context, 'Scanner could not start. Check camera permission.');
    return;
  }
  if (shots == null || shots.isEmpty || !context.mounted) return;

  final size = await _askPageSize(context);
  if (size == null || !context.mounted) return;

  await _run(
    context,
    'Building PDF',
        (report) => ConversionService.imagesToPdf(
      images: shots!.map(File.new).toList(),
      pageSize: size,
      fileName: 'Scan',
      onProgress: (d, t) => report('Page $d of $t'),
    ),
  );
}

Future<void> _imagesToPdf(BuildContext context) async {
  final picked = await picker.ImagePicker().pickMultiImage();
  if (picked.isEmpty || !context.mounted) return;

  final size = await _askPageSize(context);
  if (size == null || !context.mounted) return;

  await _run(
    context,
    'Building PDF',
        (report) => ConversionService.imagesToPdf(
      images: picked.map((x) => File(x.path)).toList(),
      pageSize: size,
      onProgress: (d, t) => report('Image $d of $t'),
    ),
  );
}

Future<void> _pdfToImages(BuildContext context) async {
  final file = await _pickPdf();
  if (file == null || !context.mounted) return;

  final format = await _askFormat(
    context,
    const [ImageFormat.png, ImageFormat.jpg],
    'Export pages as',
  );
  if (format == null || !context.mounted) return;

  await _runMulti(
    context,
    'Exporting pages',
        (report) => ConversionService.pdfToImages(
      pdf: file,
      format: format,
      onProgress: (d, t) => report(t == null ? 'Page $d' : 'Page $d of $t'),
    ),
  );
}

Future<void> _convertImage(BuildContext context) async {
  final x = await picker.ImagePicker().pickImage(source: picker.ImageSource.gallery);
  if (x == null || !context.mounted) return;

  final format = await _askFormat(context, ImageFormat.values, 'Convert to');
  if (format == null || !context.mounted) return;

  await _run(
    context,
    'Converting',
        (_) => ConversionService.convertImage(
      source: File(x.path),
      format: format,
    ),
  );
}

Future<void> _compressImage(BuildContext context) async {
  final x = await picker.ImagePicker().pickImage(source: picker.ImageSource.gallery);
  if (x == null || !context.mounted) return;

  final quality = await _askQuality(context);
  if (quality == null || !context.mounted) return;

  await _run(
    context,
    'Compressing',
        (_) => ConversionService.compressImage(
      source: File(x.path),
      quality: quality,
    ),
  );
}

Future<void> _mergePdfs(BuildContext context) async {
  final result = await FilePicker.pickFiles(
    type: FileType.custom,
    allowedExtensions: ['pdf'],
    allowMultiple: true,
  );
  final files = (result ?? [])
      .map((f) => f.path)
      .whereType<String>()
      .map(File.new)
      .toList();
  if (files.length < 2) {
    if (context.mounted && files.isNotEmpty) {
      _snack(context, 'Pick at least two PDFs to merge.');
    }
    return;
  }
  if (!context.mounted) return;

  await _run(
    context,
    'Merging',
        (report) => ConversionService.mergePdfs(
      files: files,
      onProgress: (d, t) => report('File $d of $t'),
    ),
  );
}

Future<void> _splitPdf(BuildContext context) async {
  final file = await _pickPdf();
  if (file == null || !context.mounted) return;

  int total;
  try {
    total = await ConversionService.pageCount(file);
  } catch (_) {
    if (context.mounted) _snack(context, 'Could not read that PDF.');
    return;
  }
  if (!context.mounted) return;

  final range = await _askRange(context, total);
  if (range == null || !context.mounted) return;

  await _run(
    context,
    'Splitting',
        (_) => ConversionService.splitPdf(
      pdf: file,
      fromPage: range.$1,
      toPage: range.$2,
    ),
  );
}

// =============================================================================
//  RUNNERS
// =============================================================================

Future<File?> _pickPdf() async {
  final result = await FilePicker.pickFiles(
    type: FileType.custom,
    allowedExtensions: ['pdf'],
  );
  final path = (result == null || result.isEmpty) ? null : result.first.path;
  return path == null ? null : File(path);
}

Future<void> _run(
    BuildContext context,
    String title,
    Future<File> Function(void Function(String) report) task,
    ) async {
  final status = ValueNotifier<String>('Starting');
  _showProgress(context, title, status);

  try {
    final out = await task((s) => status.value = s);
    if (!context.mounted) return;
    Navigator.of(context).pop();
    await _showResult(context, [out]);
  } on ConversionException catch (e) {
    if (!context.mounted) return;
    Navigator.of(context).pop();
    _snack(context, e.message);
  } catch (_) {
    if (!context.mounted) return;
    Navigator.of(context).pop();
    _snack(context, 'Something went wrong during conversion.');
  } finally {
    status.dispose();
  }
}

Future<void> _runMulti(
    BuildContext context,
    String title,
    Future<List<File>> Function(void Function(String) report) task,
    ) async {
  final status = ValueNotifier<String>('Starting');
  _showProgress(context, title, status);

  try {
    final out = await task((s) => status.value = s);
    if (!context.mounted) return;
    Navigator.of(context).pop();
    await _showResult(context, out);
  } on ConversionException catch (e) {
    if (!context.mounted) return;
    Navigator.of(context).pop();
    _snack(context, e.message);
  } catch (_) {
    if (!context.mounted) return;
    Navigator.of(context).pop();
    _snack(context, 'Something went wrong during conversion.');
  } finally {
    status.dispose();
  }
}

void _showProgress(
    BuildContext context, String title, ValueNotifier<String> status) {
  showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (_) => AlertDialog(
      content: Row(
        children: [
          const SizedBox(
              width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4)),
          const SizedBox(width: 18),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 2),
                ValueListenableBuilder<String>(
                  valueListenable: status,
                  builder: (_, s, __) =>
                      Text(s, style: Theme.of(context).textTheme.bodySmall),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

Future<void> _showResult(BuildContext context, List<File> files) async {
  final total = files.fold<int>(0, (s, f) => s + f.lengthSync());

  await showModalBottomSheet<void>(
    context: context,
    builder: (sheet) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              files.length == 1
                  ? 'Saved 1 file'
                  : 'Saved ${files.length} files',
              style: Theme.of(sheet).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              '${ConversionService.humanSize(total)}  ·  '
                  '${files.first.parent.path.split('/').last}',
              style: Theme.of(sheet).textTheme.bodySmall,
            ),
            const SizedBox(height: 6),
            Text(
              files.first.path.split('/').last,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(sheet).textTheme.bodySmall,
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    icon: const Icon(Icons.ios_share, size: 18),
                    label: const Text('Share'),
                    onPressed: () async {
                      await SharePlus.instance.share(
                        ShareParams(
                          files: files.map((f) => XFile(f.path)).toList(),
                        ),
                      );
                    },
                  ),
                ),
                if (files.length == 1 && files.first.path.endsWith('.pdf')) ...[
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.print_outlined, size: 18),
                      label: const Text('Print'),
                      onPressed: () =>
                          ConversionService.printPdf(files.first),
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    ),
  );
}

// =============================================================================
//  OPTION PICKERS
// =============================================================================

Future<PageSizeOption?> _askPageSize(BuildContext context) =>
    _chooser<PageSizeOption>(context, 'Page size', const {
      PageSizeOption.a4: 'A4',
      PageSizeOption.letter: 'Letter',
      PageSizeOption.fitImage: 'Fit each image',
    });

Future<ImageFormat?> _askFormat(
    BuildContext context,
    List<ImageFormat> options,
    String title,
    ) =>
    _chooser<ImageFormat>(
      context,
      title,
      {for (final f in options) f: f.label},
    );

Future<int?> _askQuality(BuildContext context) =>
    _chooser<int>(context, 'Compression', const {
      85: 'Light  ·  best quality',
      70: 'Balanced  ·  recommended',
      50: 'Strong  ·  smallest file',
    });

Future<T?> _chooser<T>(
    BuildContext context,
    String title,
    Map<T, String> options,
    ) {
  return showModalBottomSheet<T>(
    context: context,
    builder: (sheet) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
            child: Text(title, style: Theme.of(sheet).textTheme.titleMedium),
          ),
          for (final e in options.entries)
            ListTile(
              title: Text(e.value),
              onTap: () => Navigator.of(sheet).pop(e.key),
            ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
}

Future<(int, int)?> _askRange(BuildContext context, int total) {
  final from = TextEditingController(text: '1');
  final to = TextEditingController(text: '$total');

  return showDialog<(int, int)>(
    context: context,
    builder: (dialog) => AlertDialog(
      title: const Text('Page range'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('This PDF has $total pages.',
              style: Theme.of(dialog).textTheme.bodySmall),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: from,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'From'),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: TextField(
                  controller: to,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'To'),
                ),
              ),
            ],
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialog).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () {
            final a = int.tryParse(from.text);
            final b = int.tryParse(to.text);
            if (a == null || b == null) return;
            Navigator.of(dialog).pop((a, b));
          },
          child: const Text('Split'),
        ),
      ],
    ),
  );
}

void _snack(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}