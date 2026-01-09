'use client';

import { useAuth } from '@/hooks/use-auth';
import type { User } from '@project/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowRight,
  Shield,
  Zap,
  Settings,
  Upload,
  Film,
  Scissors,
  Play,
  Server,
} from 'lucide-react';
import Link from 'next/link';

export default function Home() {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (isAuthenticated && user) {
    return <AuthenticatedView user={user} />;
  }

  return <UnauthenticatedView />;
}

function AuthenticatedView({ user }: { user: User }) {
  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Welcome Section */}
      <div className="mb-12">
        <h1 className="text-4xl font-bold text-foreground mb-4">
          Welcome back, {user.name || user.email}! 👋
        </h1>
        <p className="text-xl text-muted-foreground">
          Ready to create amazing videos? Upload your media and start editing.
        </p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload Video
            </CardTitle>
            <CardDescription>
              Upload your video files to start editing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/uploads">
              <Button className="w-full">
                Go to Uploads
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Film className="h-5 w-5" />
              Media Library
            </CardTitle>
            <CardDescription>
              Browse and manage your video media collection
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/media">
              <Button className="w-full">
                View Media
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Profile Settings
            </CardTitle>
            <CardDescription>
              Update your profile information and preferences
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/profile">
              <Button variant="outline" className="w-full">
                Manage Profile
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* User Info */}
      <Card>
        <CardHeader>
          <CardTitle>Your Account</CardTitle>
          <CardDescription>Account information and status</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Email:</span>
            <span className="text-sm text-muted-foreground">{user.email}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Name:</span>
            <span className="text-sm text-muted-foreground">
              {user.name || 'Not set'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Status:</span>
            <Badge variant="default">Active</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UnauthenticatedView() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16 max-w-6xl">
        <div className="text-center mb-16">
          <h1 className="text-5xl md:text-6xl font-bold text-foreground mb-6">
            VideoWare
            <span className="block text-primary">Web-Based Video Editor</span>
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Create, edit, and manage your videos with our powerful self-hostable
            web-based video editor. Upload your media, trim clips, and export
            professional videos—all in your browser. Choose between local or
            cloud processing to fit your needs.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/signup">
              <Button size="lg" className="text-lg px-8 py-6">
                Get Started
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" size="lg" className="text-lg px-8 py-6">
                Sign In
              </Button>
            </Link>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-16">
          <FeatureCard
            icon={<Upload className="h-8 w-8" />}
            title="Easy Upload"
            description="Drag and drop or browse to upload your video files. Supports multiple formats with automatic processing."
          />
          <FeatureCard
            icon={<Scissors className="h-8 w-8" />}
            title="Video Editing"
            description="Trim, cut, and edit your videos with intuitive tools. Create professional content without leaving your browser."
          />
          <FeatureCard
            icon={<Film className="h-8 w-8" />}
            title="Media Library"
            description="Organize and manage all your video assets in one place. Quick access to your entire media collection."
          />
          <FeatureCard
            icon={<Play className="h-8 w-8" />}
            title="Preview & Export"
            description="Watch your edits in real-time with our built-in player. Export in multiple formats when you're ready."
          />
          <FeatureCard
            icon={<Zap className="h-8 w-8" />}
            title="Flexible Processing"
            description="Choose between local processing for complete control or cloud processing for scalability. Configure the option that works best for your setup."
          />
          <FeatureCard
            icon={<Server className="h-8 w-8" />}
            title="Self-Hostable"
            description="Deploy VideoWare on your own infrastructure for complete data sovereignty. Full control over your video processing pipeline and storage."
          />
          <FeatureCard
            icon={<Shield className="h-8 w-8" />}
            title="Secure & Private"
            description="Your videos are stored securely with encryption. Full control over your content and privacy settings."
          />
        </div>

        {/* CTA Section */}
        <div className="text-center">
          <Card className="max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle className="text-2xl">
                Ready to start editing?
              </CardTitle>
              <CardDescription className="text-lg">
                Join creators who are making amazing videos with VideoWare. Sign
                up now and get started in seconds.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/signup">
                  <Button size="lg" className="w-full sm:w-auto">
                    Create Account
                  </Button>
                </Link>
                <Link href="/login">
                  <Button
                    variant="outline"
                    size="lg"
                    className="w-full sm:w-auto"
                  >
                    Sign In
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-center gap-3 mb-2">
          <div className="text-primary">{icon}</div>
          <CardTitle className="text-xl">{title}</CardTitle>
        </div>
        <CardDescription className="text-base leading-relaxed">
          {description}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
