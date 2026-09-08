import React from 'react';
import { Camera, AlertTriangle, Settings, Activity, ShieldAlert, Video, Bot } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { FloatingCopilot } from '../FloatingCopilot';

const Sidebar = () => {
  const location = useLocation();
  
  const menuItems = [
    { name: 'Dashboard', path: '/', icon: Activity },
    { name: 'AI Copilot', path: '/copilot', icon: Bot },
    { name: 'Incidents', path: '/incidents', icon: ShieldAlert },
    { name: 'Cameras', path: '/cameras', icon: Video },
    { name: 'Zones', path: '/zones', icon: Camera },
    { name: 'Settings', path: '/settings', icon: Settings },
  ];

  return (
    <div className="w-64 bg-slate-900 text-slate-300 h-screen flex flex-col fixed left-0 top-0 z-50">
      <div className="p-6 border-b border-slate-800 flex items-center gap-3 text-white">
        <AlertTriangle className="text-red-500" />
        <span className="font-bold text-xl tracking-tight">IBVAP</span>
      </div>
      
      <nav className="flex-1 py-6">
        <ul className="space-y-1">
          {menuItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <li key={item.name}>
                <Link 
                  to={item.path} 
                  className={`flex items-center gap-3 px-6 py-3 transition-colors ${
                    isActive 
                      ? 'bg-slate-800 text-white border-l-4 border-blue-500' 
                      : 'hover:bg-slate-800/50 hover:text-white border-l-4 border-transparent'
                  }`}
                >
                  <item.icon size={20} />
                  <span className="font-medium">{item.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      
      <div className="p-4 border-t border-slate-800 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          <span>System Online</span>
        </div>
      </div>
    </div>
  );
};

export const Layout: React.FC<{children: React.ReactNode}> = ({ children }) => {
  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar />
      <div className="flex-1 ml-64 p-8 overflow-auto w-full">
        {children}
      </div>
      <FloatingCopilot />
    </div>
  );
};
