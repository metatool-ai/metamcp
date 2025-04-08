'use client';

import {
  Code2,
  FileText,
  Info,
  Key,
  Leaf,
  Plus,
  Search,
  Server,
  Settings,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react';
// import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter, // Added SidebarFooter here
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';
import { useCodes } from '@/hooks/use-codes';
import { useToast } from '@/hooks/use-toast';

import { ProfileSwitcher } from './profile-switcher';
import { ProjectSwitcher } from './project-switcher';

export default function SidebarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { codes, createCode, deleteCode } = useCodes();
  const [open, setOpen] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [selectedCodeUuid, setSelectedCodeUuid] = React.useState<string | null>(
    null
  );
  const [fileName, setFileName] = React.useState('');
  const { toast } = useToast();

  const handleCreateCode = async () => {
    if (fileName.trim()) {
      await createCode(fileName, '');
      setFileName('');
      setOpen(false);
    }
  };

  return (
    <SidebarProvider>
      <div className='flex flex-1 h-screen'>
        {/* Main Sidebar */}
        <Sidebar collapsible='none' className='w-64 flex-shrink-0 border-r'>
          <SidebarHeader className='flex flex-col justify-center items-center px-2 py-4'>
            <div className='flex items-center gap-4 mb-2'>
              <Leaf className='size-8' />
              <h2 className='text-2xl font-semibold'>mcp.garden</h2>
            </div>
            <ProjectSwitcher />
            <ProfileSwitcher />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Navigation</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href='/setup-guide'>
                        <Info className='mr-2 h-4 w-4' />
                        <span>Setup Guide</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href='/search'>
                        <Search className='mr-2 h-4 w-4' />
                        <span>Explore & Search (Beta)</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href='/mcp-servers'>
                        <Server className='mr-2 h-4 w-4' />
                        <span>MCP Servers</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href='/tool-management'>
                        <Wrench className='mr-2 h-4 w-4' />
                        <span>Tool Management</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href='/tool-execution-logs'>
                        <FileText className='mr-2 h-4 w-4' />
                        <span>Tool Execution Logs</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {/* <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href='/custom-mcp-servers'>
                        <Wrench className='mr-2 h-4 w-4' />
                        <span>Custom MCP Servers</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem> */}
                  {/* <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href='/editor'>
                        <Code2 className='mr-2 h-4 w-4' />
                        <span>Python Code Editor</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem> */}
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href='/api-keys'>
                        <Key className='mr-2 h-4 w-4' />
                        <span>API Keys</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href='/inspector-guide'>
                        <Terminal className='mr-2 h-4 w-4' />
                        <span>Inspector Guide</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href='/settings'>
                        <Settings className='mr-2 h-4 w-4' />
                        <span>Settings</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter />

        </Sidebar>

        {/* Secondary Sidebar */}
        {pathname?.startsWith('/editor') && (
          <Sidebar collapsible='none' className='w-64 flex-shrink-0 border-r'>
            <SidebarHeader className='h-16 flex items-center px-4 mt-4'>
              <h2 className='text-lg font-semibold'>Code Files</h2>
            </SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>Files</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <Dialog open={open} onOpenChange={setOpen}>
                        <DialogTrigger asChild>
                          <SidebarMenuButton>
                            <Plus className='h-4 w-4 mr-2' />
                            <span>New Code File</span>
                          </SidebarMenuButton>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Create New Code File</DialogTitle>
                            <DialogDescription>
                              Enter a name for your new code file.
                            </DialogDescription>
                          </DialogHeader>
                          <div className='py-4'>
                            <Input
                              value={fileName}
                              onChange={(e) => setFileName(e.target.value)}
                              placeholder='Enter file name'
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleCreateCode();
                                }
                              }}
                            />
                          </div>
                          <DialogFooter>
                            <Button
                              variant='outline'
                              onClick={() => setOpen(false)}>
                              Cancel
                            </Button>
                            <Button onClick={handleCreateCode}>Create</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </SidebarMenuItem>
                    {codes.map((code) => (
                      <SidebarMenuItem key={code.uuid}>
                        <SidebarMenuButton asChild className='w-full'>
                          <Link
                            href={`/editor/${code.uuid}`}
                            className='flex items-center w-full group'>
                            <div className='flex-grow flex items-center'>
                              <Code2 className='mr-2 h-4 w-4' />
                              <span>{code.fileName}</span>
                            </div>
                            <Button
                              variant='ghost'
                              size='icon'
                              className='h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity'
                              onClick={(e) => {
                                e.preventDefault();
                                setSelectedCodeUuid(code.uuid);
                                setDeleteDialogOpen(true);
                              }}>
                              <Trash2 className='h-4 w-4 text-muted-foreground hover:text-destructive' />
                            </Button>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
        )}

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Code File</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this code file? This action
                cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant='outline'
                onClick={() => setDeleteDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                variant='destructive'
                onClick={async () => {
                  if (selectedCodeUuid) {
                    try {
                      await deleteCode(selectedCodeUuid);
                      setDeleteDialogOpen(false);
                      setSelectedCodeUuid(null);
                    } catch (_error) {
                      console.error(_error);
                      toast({
                        variant: 'destructive',
                        title: 'Failed to delete code',
                        description:
                          'Make sure the code is not used in any Custom MCP Servers and try again.',
                      });
                    }
                  }
                }}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Main Content Area */}
        <SidebarInset className='flex-grow'>
          <main className='h-full overflow-auto'>{children}</main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
