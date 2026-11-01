import { defineModule } from '../../core/registry';
import { mountPlanner } from './view';

export default defineModule({
  id: 'farm',
  title: 'Фарм',
  icon: 'farm',
  order: 10,
  description: 'Маршрут фарма: реликвии, миссии, ротации, шансы и текущие разрывы',
  mount: (root, ctx) => mountPlanner(root, ctx),
});
