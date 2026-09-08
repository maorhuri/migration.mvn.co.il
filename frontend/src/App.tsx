import { Routes, Route, Link, useLocation } from 'react-router-dom';
import {
  ServerStackIcon,
  ArrowsRightLeftIcon,
  KeyIcon,
  HomeIcon,
} from '@heroicons/react/24/outline';
import Dashboard from './pages/Dashboard';
import Servers from './pages/Servers';
import ServerDetail from './pages/ServerDetail';
import Migrations from './pages/Migrations';
import SSHKeys from './pages/SSHKeys';
import NewMigration from './pages/NewMigration';
import MigrationDetail from './pages/MigrationDetail';

const navigation = [
  { name: 'Dashboard', href: '/', icon: HomeIcon },
  { name: 'Servers', href: '/servers', icon: ServerStackIcon },
  { name: 'Migrations', href: '/migrations', icon: ArrowsRightLeftIcon },
  { name: 'SSH Keys', href: '/ssh-keys', icon: KeyIcon },
];

function App() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="fixed inset-y-0 left-0 w-64 bg-white border-r border-gray-200">
        <div className="flex items-center h-16 px-6 border-b border-gray-200">
          <ArrowsRightLeftIcon className="w-8 h-8 text-primary-600" />
          <span className="ml-2 text-xl font-bold text-gray-900">Migration Tool</span>
        </div>
        <nav className="p-4 space-y-1">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href || 
              (item.href !== '/' && location.pathname.startsWith(item.href));
            return (
              <Link
                key={item.name}
                to={item.href}
                className={`flex items-center px-4 py-2.5 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <item.icon className="w-5 h-5 mr-3" />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main content */}
      <div className="pl-64">
        <main className="p-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/servers" element={<Servers />} />
            <Route path="/servers/:id" element={<ServerDetail />} />
            <Route path="/migrations" element={<Migrations />} />
            <Route path="/migrations/new" element={<NewMigration />} />
            <Route path="/migrations/:id" element={<MigrationDetail />} />
            <Route path="/ssh-keys" element={<SSHKeys />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default App;
