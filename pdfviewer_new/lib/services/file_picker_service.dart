import 'dart:io';

import 'package:file_picker/file_picker.dart';

/// Outcome of a PDF pick attempt. Modeled as a sealed hierarchy so the UI is
/// forced to handle cancellation and failure explicitly instead of guessing
/// from a nullable return value.
sealed class PickPdfResult {
  const PickPdfResult();
}

class PickPdfSuccess extends PickPdfResult {
  const PickPdfSuccess({
    required this.path,
    required this.name,
    required this.sizeBytes,
  });

  final String path;
  final String name;
  final int sizeBytes;
}

class PickPdfFailure extends PickPdfResult {
  const PickPdfFailure(this.message);

  final String message;
}

class PickPdfCancelled extends PickPdfResult {
  const PickPdfCancelled();
}

class FilePickerService {
  Future<PickPdfResult> pickPdf() async {
    try {
      final picked = await FilePicker.pickFile(
        type: FileType.custom,
        allowedExtensions: ['pdf'],
        dialogTitle: 'Select a PDF',
      );
      if (picked == null) return const PickPdfCancelled();

      final path = picked.path;
      if (path == null) {
        return const PickPdfFailure('Could not access the selected file.');
      }
      if (!path.toLowerCase().endsWith('.pdf')) {
        return const PickPdfFailure('Please choose a PDF file.');
      }

      final file = File(path);
      if (!await file.exists()) {
        return const PickPdfFailure('The selected file could not be found.');
      }

      final size = await file.length();
      if (size == 0) {
        return const PickPdfFailure('The selected file is empty.');
      }

      return PickPdfSuccess(path: path, name: picked.name, sizeBytes: size);
    } catch (_) {
      return const PickPdfFailure('Something went wrong while picking the file.');
    }
  }
}
