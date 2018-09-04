#!/usr/bin/perl

use strict;
use warnings;

use DBI;
use Getopt::Std;
use File::Basename qw(dirname basename);
use File::Copy;

use lib dirname(__FILE__) . '/tools';

use Cyanaudit;

sub usage
{
    my ($message) = @_;

    print "Error: $message\n" if( $message );

    print "Usage: $0 [ options ... ]\n"
        . "  -h host    database server host or socket directory\n"
        . "  -p port    database server port\n"
        . "  -U user    database user name\n"
        . "  -d db      database name\n"
        . "  -V #.#.#   version to upgrade to (blank will install latest version)\n";

    exit 1
}

chomp( my $pg_version = `pg_config --version` );
if( $pg_version =~ / 8\.| 9\.[012345]\b/ )
{
    die "Cyan Audit requires PostgreSQL 9.6.0 or above.\n";
}

my %opts;

getopts('U:h:p:d:V:', \%opts) or usage();

my $db   = ( $opts{d} || $ENV{PGDATABASE} ) or usage( "Please specify database using -d" );
my $port = ( $opts{p} || $ENV{PGPORT} || 5432 );
my $user = ( $opts{U} || $ENV{PGUSER} || 'postgres' );
my $host = ( $opts{h} || $ENV{PGHOST} || 'localhost' );

my $handle = db_connect( \%opts ) or die "Database connect error.\n";

my $sql_dir = dirname(__FILE__) . "/sql";
my $latest_version;

foreach my $file ( sort { $b cmp $a } <$sql_dir/cyanaudit--*.sql> )
{
    if( $file =~ /cyanaudit--([0-9.]+)\.sql/ )
    {
        $latest_version = $1;
        print "Package version is $latest_version\n";
        last;
    }
}

my $version_query = "select value from cyanaudit.tb_config where name = 'version'";
$handle->{RaiseError} = 0;
my ($current_version) = $handle->selectrow_array( $version_query );

my $new_version = $opts{V} || $current_version || $latest_version;
my $base_sql = "$sql_dir/cyanaudit--$new_version.sql";
unless( -r $base_sql )
{
    usage( "Invalid version ($new_version): File not found: $base_sql" );
}

my ( $pre_sql, $post_sql );

if( $new_version and $current_version and $new_version ne $current_version )
{
    print "Upgrading from $current_version to $new_version\n";

    $pre_sql = "$sql_dir/cyanaudit--$current_version--$new_version--pre.sql";
    $post_sql = "$sql_dir/cyanaudit--$current_version--$new_version--post.sql";

    unless( -r $pre_sql or -r $post_sql )
    {
        die "Upgrade scripts from $current_version to $new_version not found.\n";
    }
}
elsif( $new_version and not $current_version )
{
    print "Installing version $new_version\n";
}
elsif( $new_version eq $current_version )
{
    print "Reinstalling version $new_version\n";
}

for my $script ($pre_sql, $base_sql, $post_sql)
{
    next unless ( $script and -r $script );

    my $command = "psql -U $user -d $db -p $port -h $host -f '$script' > /dev/null";
    print "Running $script ... ";
    system( $command ) == 0 or die;
    print "Success!\n";
}

print "Getting PostgreSQL bin directory: ";
my $bindir = `pg_config --bindir` or die;
chomp( $bindir );
print "$bindir\n";

if( -w $bindir )
{
    print "Copying scripts to $bindir...\n";
    my @files = <tools/*.p[lm]>;
    foreach my $file (@files)
    {
        copy( $file, $bindir ) or die "$!";
        my $dest = $bindir . '/' . basename($file);
        print "- $dest\n";
        chmod( 0755, $dest ) or die "$!";
    }
    print "Done!\n";
}
else
{
    print "Skipping copy of scripts to $bindir: Directory is not writable.\n";
}

print "\nCyan Audit $new_version successfully installed to database '$db'.\n\n";
print "Now you must SELECT cyanaudit.fn_update_audit_fields('public')\n"
    . "   and repeat for each schema you would like to log.\n";
