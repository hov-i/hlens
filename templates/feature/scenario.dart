import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:{app package}/main.dart' as app;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('{Feature name}', (tester) async {
    app.main();
    await tester.pumpAndSettle();

    // Step: {First user action}
    expect(find.text('{on-screen text}'), findsOneWidget);

    // Step: {Second user action}
    // await tester.tap(find.text('...'));
    // await tester.pumpAndSettle();
  });
}
