import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// Generic helper for persisting a JSON array to a file in the app's support
/// directory. Writes go through a temp file + rename so a crash mid-write
/// never leaves a corrupt file behind.
class JsonFileStore {
  JsonFileStore(this.fileName);

  final String fileName;

  Future<File> _resolveFile() async {
    final dir = await getApplicationSupportDirectory();
    return File('${dir.path}/$fileName');
  }

  Future<List<dynamic>> readList() async {
    try {
      final file = await _resolveFile();
      if (!await file.exists()) return <dynamic>[];
      final contents = await file.readAsString();
      if (contents.trim().isEmpty) return <dynamic>[];
      final decoded = jsonDecode(contents);
      return decoded is List ? decoded : <dynamic>[];
    } catch (_) {
      // Missing, unreadable, or corrupt store — treat as empty rather than
      // crashing the app on startup.
      return <dynamic>[];
    }
  }

  Future<void> writeList(List<dynamic> data) async {
    final file = await _resolveFile();
    final tempFile = File('${file.path}.tmp');
    await tempFile.writeAsString(jsonEncode(data));
    await tempFile.rename(file.path);
  }
}
