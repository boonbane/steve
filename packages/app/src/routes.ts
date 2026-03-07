import { lazy } from 'solid-js';
import type { RouteDefinition } from '@solidjs/router';

import Home from './pages/home';


export const routes: RouteDefinition[] = [
  {
    path: '/',
    component: Home,
  },
  {
    path: '/account',
    component: lazy(() => import('./pages/account')),
  },
  {
    path: '/steve',
    component: lazy(() => import('./pages/steve')),
  },
  {
    path: '/steve/settings',
    component: lazy(() => import('./pages/steve-settings')),
  },
  {
    path: '/devices',
    component: lazy(() => import('./pages/devices')),
  },
  {
    path: '/billing',
    component: lazy(() => import('./pages/billing')),
  },
  {
    path: '**',
    component: lazy(() => import('./errors/404')),
  },
];
