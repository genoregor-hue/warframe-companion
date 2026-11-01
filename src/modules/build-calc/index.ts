import { defineModule } from '../../core/registry';
import { mountBuildCalc } from './view';

export default defineModule({
  id: 'builds',
  title: 'Билды',
  icon: 'builds',
  order: 20,
  description: 'Калькулятор билдов, сравнение и автосборка топ-билда из ваших модов',
  mount: (root, ctx) => mountBuildCalc(root, ctx),
});
