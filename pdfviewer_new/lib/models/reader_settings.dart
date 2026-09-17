enum ReaderThemeMode { normal, sepia, dark, night }

enum ReaderFitMode { fitWidth, fitPage }

class ReaderSettings {
  const ReaderSettings({
    this.themeMode = ReaderThemeMode.normal,
    this.fitMode = ReaderFitMode.fitWidth,
    this.keepScreenAwake = true,
    this.rememberLastPage = true,
    this.showPageNumberTooltip = true,
  });

  final ReaderThemeMode themeMode;
  final ReaderFitMode fitMode;
  final bool keepScreenAwake;
  final bool rememberLastPage;
  final bool showPageNumberTooltip;

  ReaderSettings copyWith({
    ReaderThemeMode? themeMode,
    ReaderFitMode? fitMode,
    bool? keepScreenAwake,
    bool? rememberLastPage,
    bool? showPageNumberTooltip,
  }) {
    return ReaderSettings(
      themeMode: themeMode ?? this.themeMode,
      fitMode: fitMode ?? this.fitMode,
      keepScreenAwake: keepScreenAwake ?? this.keepScreenAwake,
      rememberLastPage: rememberLastPage ?? this.rememberLastPage,
      showPageNumberTooltip:
          showPageNumberTooltip ?? this.showPageNumberTooltip,
    );
  }
}
