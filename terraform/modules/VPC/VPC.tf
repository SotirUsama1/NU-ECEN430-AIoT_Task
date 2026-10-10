resource "aws_vpc" "example" {
  count = var.vpc_count

  cidr_block = element(local.cidr_blocks, count.index)

  enable_dns_support = var.enable_dns_support
  enable_dns_hostnames = var.enable_dns_hostnames

  tags = merge(
    {
      Name  = var.vpc_count > 1 ? format("%s-%d", local.vpc_name, count.index + 1) : local.vpc_name
    },
    var.tags
  )
}

resource "aws_subnet" "public" {
  count = var.public_subnet_count * var.availability_zones * var.vpc_count

  vpc_id            = aws_vpc.example[floor(count.index / (var.public_subnet_count * var.availability_zones))].id
  cidr_block        = element(local.subnets_cidrs.public, count.index)
  availability_zone = local.availability_zones[floor(count.index / var.public_subnet_count) % var.availability_zones]

  tags = merge(
    {
      Name = format(
        "%s-public_subnet-%d",
        aws_vpc.example[floor(count.index / (var.public_subnet_count * var.availability_zones))].tags.Name,
        (count.index % (var.public_subnet_count * var.availability_zones)) + 1
      )
    },
    var.tags
  )
}

resource "aws_subnet" "private" {
  count = var.private_subnet_count * var.availability_zones * var.vpc_count

  vpc_id            = aws_vpc.example[floor(count.index / (var.private_subnet_count * var.availability_zones))].id
  cidr_block        = element(local.subnets_cidrs.private, count.index)
  availability_zone = local.availability_zones[floor(count.index / var.private_subnet_count) % var.availability_zones]

  tags = merge(
    {
      Name = format(
        "%s-private_subnet-%d",
        aws_vpc.example[floor(count.index / (var.private_subnet_count * var.availability_zones))].tags.Name,
        (count.index % (var.private_subnet_count * var.availability_zones)) + 1
      )
    },
    var.tags
  )
}

resource "aws_subnet" "isolated" {
  count = var.isolated_subnet_count * var.availability_zones * var.vpc_count

  vpc_id            = aws_vpc.example[floor(count.index / (var.isolated_subnet_count * var.availability_zones))].id
  cidr_block        = element(local.subnets_cidrs.isolated, count.index)
  availability_zone = local.availability_zones[floor(count.index / var.isolated_subnet_count) % var.availability_zones]

  tags = merge(
    {
      Name = format(
        "%s-isolated_subnet-%d",
        aws_vpc.example[floor(count.index / (var.isolated_subnet_count * var.availability_zones))].tags.Name,
        (count.index % (var.isolated_subnet_count * var.availability_zones)) + 1
      )
    },
    var.tags
  )
}

resource "aws_internet_gateway" "main" {
  count = var.vpc_count

  vpc_id = aws_vpc.example[count.index].id

  tags = merge(
    {
      Name = format("%s-igw", aws_vpc.example[count.index].tags.Name)
    },
    var.tags
  )
}

resource "aws_route_table" "public" {
  count = var.vpc_count

  vpc_id = aws_vpc.example[count.index].id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main[count.index].id
  }

  tags = merge(
    {
      Name = format("%s-public-rt", aws_vpc.example[count.index].tags.Name)
    },
    var.tags
  )
}

resource "aws_route_table_association" "public" {
  count = var.public_subnet_count * var.availability_zones * var.vpc_count

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public[floor(count.index / (var.public_subnet_count * var.availability_zones))].id
}