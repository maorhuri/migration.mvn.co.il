import { Routes, Route } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import Dashboard from './pages/Dashboard';
import Servers from './pages/Servers';
import ServerDetail from './pages/ServerDetail';
import Migrations from './pages/Migrations';
import SSHKeys from './pages/SSHKeys';
import NewMigration from './pages/NewMigration';
import MigrationDetail from './pages/MigrationDetail';

function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/servers" element={<Servers />} />
        <Route path="/servers/:id" element={<ServerDetail />} />
        <Route path="/migrations" element={<Migrations />} />
        <Route path="/migrations/new" element={<NewMigration />} />
        <Route path="/migrations/:id" element={<MigrationDetail />} />
        <Route path="/ssh-keys" element={<SSHKeys />} />
      </Routes>
    </AppShell>
  );
}

export default App;
