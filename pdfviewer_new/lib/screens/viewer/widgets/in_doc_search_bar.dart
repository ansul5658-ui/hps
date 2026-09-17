import 'package:flutter/material.dart';
import 'package:syncfusion_flutter_pdfviewer/pdfviewer.dart';

class InDocSearchBar extends StatefulWidget {
  const InDocSearchBar({
    super.key,
    required this.searchResult,
    required this.onSearch,
    required this.onClose,
  });

  final PdfTextSearchResult searchResult;
  final ValueChanged<String> onSearch;
  final VoidCallback onClose;

  @override
  State<InDocSearchBar> createState() => _InDocSearchBarState();
}

class _InDocSearchBarState extends State<InDocSearchBar> {
  final TextEditingController _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final text = _controller.text.trim();
    if (text.isNotEmpty) {
      widget.onSearch(text);
    }
  }

  @override
  Widget build(BuildContext context) {
    final total = widget.searchResult.totalInstanceCount;
    final current = widget.searchResult.currentInstanceIndex;

    return Container(
      color: Theme.of(context).colorScheme.surface,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _controller,
              textInputAction: TextInputAction.search,
              autofocus: true,
              onSubmitted: (_) => _submit(),
              decoration: InputDecoration(
                hintText: 'Search text in document...',
                isDense: true,
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                suffixIcon: IconButton(
                  icon: const Icon(Icons.search_rounded, size: 20),
                  onPressed: _submit,
                ),
              ),
            ),
          ),
          if (total > 0) ...[
            const SizedBox(width: 8),
            Text(
              '$current / $total',
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
            ),
            IconButton(
              icon: const Icon(Icons.chevron_left_rounded),
              onPressed: () => widget.searchResult.previousInstance(),
            ),
            IconButton(
              icon: const Icon(Icons.chevron_right_rounded),
              onPressed: () => widget.searchResult.nextInstance(),
            ),
          ],
          IconButton(
            icon: const Icon(Icons.close_rounded),
            onPressed: widget.onClose,
          ),
        ],
      ),
    );
  }
}
