import { 
  HomeIcon, 
  ScanLineIcon,
  TrendingUpIcon,
  BellIcon,
  BarChart3Icon,
  SparklesIcon,
  CpuIcon,
  MenuIcon
} from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';
import { Button } from './ui/button';
import Logo from './Logo';

interface NavigationProps {
  currentScreen: string;
  setCurrentScreen: (screen: string) => void;
}

export default function Navigation({ currentScreen, setCurrentScreen }: NavigationProps) {
  const mainNavItems = [
    { id: 'dashboard', icon: HomeIcon, label: 'Home' },
    { id: 'sorting', icon: ScanLineIcon, label: 'Sorting' },
    { id: 'notifications', icon: BellIcon, label: 'Alerts' },
  ];

  const menuItems = [
    { id: 'dashboard', icon: HomeIcon, label: 'Dashboard' },
    { id: 'sorting', icon: ScanLineIcon, label: 'Fruit Sorting' },
    { id: 'fermentation', icon: TrendingUpIcon, label: 'Fermentation' },
    { id: 'notifications', icon: BellIcon, label: 'Notifications' },
    { id: 'reports', icon: BarChart3Icon, label: 'Reports' },
    { id: 'insights', icon: SparklesIcon, label: 'AI Insights' },
    { id: 'devices', icon: CpuIcon, label: 'Devices' },
  ];

  return (
    <>
      {/* Bottom Navigation */}
     <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
  <div className="w-full">
          <div className="flex items-center justify-around p-2">
            {mainNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentScreen === item.id;
              
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentScreen(item.id)}
                  className={`flex flex-col items-center justify-center p-2 rounded-lg min-w-[70px] transition-colors ${
                    isActive
                      ? 'text-[#8B1538]'
                      : 'text-gray-500'
                  }`}
                >
                  <Icon className={`w-6 h-6 mb-1 ${isActive ? 'fill-[#8B1538]' : ''}`} />
                  <span className="text-xs">{item.label}</span>
                </button>
              );
            })}
            
            {/* Menu Sheet Trigger */}
            <Sheet>
              <SheetTrigger asChild>
                <button className="flex flex-col items-center justify-center p-2 rounded-lg min-w-[70px] text-gray-500">
                  <MenuIcon className="w-6 h-6 mb-1" />
                  <span className="text-xs">More</span>
                </button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-w-md mx-auto rounded-t-3xl">
                <SheetHeader className="flex flex-col items-center">
                  <Logo size="md" className="mb-2" />
                  <SheetTitle>All Features</SheetTitle>
                  <SheetDescription>
                    Navigate to different sections of the app
                  </SheetDescription>
                </SheetHeader>
                <div className="grid grid-cols-2 gap-3 mt-6 pb-4">
                  {menuItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = currentScreen === item.id;
                    
                    return (
                      <Button
                        key={item.id}
                        variant={isActive ? "default" : "outline"}
                        className={`h-auto py-4 flex flex-col gap-2 ${
                          isActive ? 'bg-[#8B1538] hover:bg-[#6B1028]' : ''
                        }`}
                        onClick={() => {
                          setCurrentScreen(item.id);
                          // Close sheet programmatically if needed
                        }}
                      >
                        <Icon className="w-6 h-6" />
                        <span className="text-xs">{item.label}</span>
                      </Button>
                    );
                  })}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </>
  );
}
