// =============================================================================
//  lib/main.dart  —  crash-proof startup
// =============================================================================
//  Same architecture as before (provider + repositories + ThemeProvider),
//  with one change that matters: runApp() is now GUARANTEED to run.
//
//  Previously all three init() calls were awaited before runApp() with no
//  error handling. Any exception there meant runApp() never executed, so no
//  widget tree was ever built — which renders as a plain black screen with
//  no error message, because Flutter's red error screen only exists AFTER
//  runApp().
//
//  Now each init() is isolated. If one fails you get a readable screen
//  naming the failure instead of silence.
//
//  NOTE ON THE SYNCFUSION LICENSE:
//  The Community License is approved and on file for this project. No
//  registerLicense() call is made here because neither SyncfusionLicense nor
//  SyncfusionLicenseProvider resolves in syncfusion_flutter_core 34.2.7, and
//  release builds show no watermark or banner without it. If a licensing
//  notice ever does appear in a release build, find the real class name with:
//      Get-ChildItem "$env:LOCALAPPDATA\Pub\Cache\hosted\pub.dev\
//        syncfusion_flutter_core-34.2.7\lib" -Recurse -Filter *.dart |
//        Select-String -Pattern "registerLicense"
//  then add the import and the one-line call right after
//  WidgetsFlutterBinding.ensureInitialized() below.
// =============================================================================

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app/app.dart';
import 'core/theme/theme_provider.dart';
import 'repositories/bookmarks_repository.dart';
import 'repositories/library_repository.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Readable in-app errors instead of the grey/black void.
  ErrorWidget.builder = (FlutterErrorDetails details) => _ErrorPane(
    title: 'Widget build failed',
    body: '${details.exception}',
  );

  final failures = <_Failure>[];

  final libraryRepository = LibraryRepository();
  await _guard('LibraryRepository.init()', libraryRepository.init, failures);

  final bookmarksRepository = BookmarksRepository();
  await _guard('BookmarksRepository.init()', bookmarksRepository.init, failures);

  final themeProvider = ThemeProvider();
  await _guard('ThemeProvider.init()', themeProvider.init, failures);

  if (failures.isNotEmpty) {
    runApp(_StartupFailureApp(failures: failures));
    return;
  }

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<LibraryRepository>.value(value: libraryRepository),
        ChangeNotifierProvider<BookmarksRepository>.value(value: bookmarksRepository),
        ChangeNotifierProvider<ThemeProvider>.value(value: themeProvider),
      ],
      child: const PdfViewerApp(),
    ),
  );
}

class _Failure {
  _Failure(this.where, this.error, this.stack);
  final String where;
  final Object error;
  final StackTrace stack;
}

Future<void> _guard(
    String where,
    Future<void> Function() task,
    List<_Failure> sink,
    ) async {
  try {
    await task();
    debugPrint('[startup] OK   $where');
  } catch (e, s) {
    debugPrint('[startup] FAIL $where -> $e');
    sink.add(_Failure(where, e, s));
  }
}

// =============================================================================
//  Failure screen — shown only when startup breaks
// =============================================================================

class _StartupFailureApp extends StatelessWidget {
  const _StartupFailureApp({required this.failures});
  final List<_Failure> failures;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(useMaterial3: true),
      home: _ErrorPane(
        title: '${failures.length} startup step'
            '${failures.length == 1 ? '' : 's'} failed',
        body: failures
            .map((f) => '${f.where}\n\n${f.error}\n\n${f.stack}')
            .join('\n\n${'-' * 56}\n\n'),
      ),
    );
  }
}

class _ErrorPane extends StatelessWidget {
  const _ErrorPane({required this.title, required this.body});
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.ltr,
      child: Material(
        color: const Color(0xFF1A1210),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Color(0xFFFF8A80),
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Startup stopped here. Copy this and it can be fixed.',
                  style: TextStyle(color: Color(0xFFB0A6A2), fontSize: 13),
                ),
                const SizedBox(height: 16),
                Expanded(
                  child: SingleChildScrollView(
                    child: SelectableText(
                      body,
                      style: const TextStyle(
                        color: Color(0xFFEDE4E1),
                        fontSize: 12,
                        height: 1.45,
                        fontFamily: 'monospace',
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}