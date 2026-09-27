import 'package:flutter/material.dart';

import '../../data/common_kernel_client.dart';

final class ShoppingCorrectionScreen extends StatefulWidget {
  const ShoppingCorrectionScreen({
    required this.client,
    required this.activityId,
    super.key,
  });

  final CommonKernelClient client;
  final String activityId;

  @override
  State<ShoppingCorrectionScreen> createState() =>
      _ShoppingCorrectionScreenState();
}

final class _ShoppingCorrectionScreenState
    extends State<ShoppingCorrectionScreen> {
  KernelJson? _data;
  KernelJson? _pending;
  String? _selectedImportId;
  int _quantity = 1;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final data = await widget.client.getEditableShoppingChoice(
        widget.activityId,
      );
      if (!mounted) return;
      final choice = Map<String, Object?>.from(data['choice'] as Map);
      setState(() {
        _data = data;
        _selectedImportId = choice['importId'] as String;
        _quantity = choice['quantity'] as int;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _review() async {
    final data = _data;
    final selectedImportId = _selectedImportId;
    if (_busy || _pending != null || data == null || selectedImportId == null) {
      return;
    }
    final choice = Map<String, Object?>.from(data['choice'] as Map);
    if (choice['importId'] == selectedImportId &&
        choice['quantity'] == _quantity) {
      setState(() => _error = '변경된 상품 선택이 없어요.');
      return;
    }
    final candidate = (data['candidates'] as List).whereType<Map>().firstWhere(
      (item) => item['importId'] == selectedImportId,
    );
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('쇼핑 선택 정정 확인'),
        content: Text(
          '${candidate['title']} · $_quantity개 · 캡처 표시 ${candidate['displayedPriceText']}\n\n'
          '기존 선택과 구매 기록은 당시 이력으로 남습니다. 변경된 선택은 새 활동에서 다시 확인해요.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('취소'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('정정 반영'),
          ),
        ],
      ),
    );
    if (!mounted || accepted != true) return;
    _pending = {
      'commandId': newKernelCommandId(),
      'activityId': widget.activityId,
      'expectedGraphFingerprint': data['graphFingerprint'],
      'selectedImportId': selectedImportId,
      'quantity': _quantity,
      'confirmed': true,
    };
    await _submit();
  }

  Future<void> _submit() async {
    final request = _pending;
    if (_busy || request == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.client.correctShoppingChoice(request);
      _pending = null;
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (!mounted) return;
      final retryable =
          error is CommonKernelException &&
          (['NETWORK_TIMEOUT', 'NETWORK_UNAVAILABLE'].contains(error.code) ||
              error.statusCode == 429 ||
              (error.statusCode != null && error.statusCode! >= 500));
      if (!retryable) _pending = null;
      setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('쇼핑 상품·수량 정정')),
    body: _data == null && _busy
        ? const Center(child: CircularProgressIndicator())
        : ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (_busy) const LinearProgressIndicator(),
              if (_error != null) ...[
                Text('정정을 확인하지 못했어요: $_error'),
                TextButton(
                  onPressed: _busy
                      ? null
                      : _pending == null
                      ? _load
                      : _submit,
                  child: Text(_pending == null ? '새로고침' : '같은 요청 다시 보내기'),
                ),
              ],
              if (_data != null) ...[
                const Text('저장된 상품 캡처 중 하나를 선택하고 수량을 확인하세요.'),
                const SizedBox(height: 12),
                for (final raw in _data!['candidates'] as List)
                  ListTile(
                    key: ValueKey(
                      'shopping-correction-${(raw as Map)['importId']}',
                    ),
                    leading: Icon(
                      _selectedImportId == raw['importId']
                          ? Icons.radio_button_checked
                          : Icons.radio_button_unchecked,
                    ),
                    onTap: _busy || _pending != null
                        ? null
                        : () => setState(
                            () => _selectedImportId = raw['importId'] as String,
                          ),
                    title: Text(raw['title'] as String),
                    subtitle: Text('캡처 표시 ${raw['displayedPriceText']}'),
                  ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    const Text('수량'),
                    IconButton(
                      key: const Key('shopping-correction-minus'),
                      onPressed: _busy || _pending != null || _quantity <= 1
                          ? null
                          : () => setState(() => _quantity--),
                      icon: const Icon(Icons.remove),
                    ),
                    Text('$_quantity개'),
                    IconButton(
                      key: const Key('shopping-correction-plus'),
                      onPressed: _busy || _pending != null || _quantity >= 20
                          ? null
                          : () => setState(() => _quantity++),
                      icon: const Icon(Icons.add),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                FilledButton(
                  key: const Key('shopping-correction-submit'),
                  onPressed: _busy || _pending != null ? null : _review,
                  child: const Text('변경 내용 확인'),
                ),
              ],
            ],
          ),
  );
}
